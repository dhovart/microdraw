//(function() {                 // force everything local.
/*eslint-env jquery*/
/*global paper*/
/*global OpenSeadragon*/
/*global localhost*/

var debug = 1;

var dbroot = localhost + "/api";
var ImageInfo = {};             // regions, and projectID (for the paper.js canvas) for each slices, can be accessed by the slice name. (e.g. ImageInfo[imageOrder[viewer.current_page()]])
                                // regions contain a paper.js path, a unique ID and a name
var imageOrder = [];            // names of slices ordered by their openseadragon page numbers
var currentImage = null;        // name of the current image
var prevImage = null;           // name of the last image
var region = null;              // currently selected region (one element of Regions[])
var copyRegion;                 // clone of the currently selected region for copy/paste
var handle;                     // currently selected control point or handle (if any)
var selectedTool;               // currently selected tool
var viewer;                     // open seadragon viewer
var navEnabled = true;          // flag indicating whether the navigator is enabled (if it's not, the annotation tools are)
var magicV = 1000;              // resolution of the annotation canvas - is changed automatically to reflect the size of the tileSource
var params;                     // URL parameters
var source;                     // data source
var slice;                      // slice index in a multi-slice dataset
//var    myIP;                  // user's IP
var UndoStack = [];
var RedoStack = [];
var mouseUndo;                  // tentative undo information.
var shortCuts = [];             // List of shortcuts
var newRegionFlag;              // true when a region is being drawn
var drawingPolygonFlag = false; // true when drawing a polygon
var annotationLoadingFlag;      // true when an annotation is being loaded
var config = {};                // App configuration object
var isMac = navigator.platform.match(/Mac/i);
var isIOS = navigator.platform.match(/(iPhone|iPod|iPad)/i);
var tolerance = 10;

/*
    Region handling functions
*/

var counter = 1;

/**
 * @function regionUID
 */
function regionUID() {
    if( debug ) {
        console.log("> regionUID");
    }

    var i;
    var found = false;
    while( found === false ) {
        found = true;
        for( i = 0; i < ImageInfo[currentImage].Regions.length; i += 1 ) {
            if( ImageInfo[currentImage].Regions[i].uid === counter ) {
                counter += 1;
                found = false;
                break;
            }
        }
    }

return counter;
}

/**
 * @function hash
 */
function hash(str) {
    var result = str.split("").reduce(function(a, b) {
        a = ((a<<5)-a) + b.charCodeAt(0);

        return a&a;
    }, 0);

    return result;
}

/**
 * @function regionHashColor
 * @desc Produces a color based on a region name.
 * @param String name Name of the region.
 */
function regionHashColor(name) {
    //if(debug) console.log("> regionHashColor");

    var color = {};
    var h = hash(name);

    // add some randomness
    h = Math.sin(h += 1)*10000;
    h = 0xffffff*(h-Math.floor(h));

    color.red = h & 0xff;
    color.green = (h & 0xff00)>>8;
    color.blue = (h & 0xff0000)>>16;

    return color;
}

/**
 * @function findRegionByUID
 */
function findRegionByUID(uid) {
    if( debug ) { console.log("> findRegionByUID"); }

    var i;
    if( debug > 2 ) { console.log( "look for uid: " + uid); }
    // if( debug > 2 ) console.log( ImageInfo );
    if( debug > 2 ) { console.log( "region array lenght: " + ImageInfo[currentImage].Regions.length ); }

    for( i = 0; i < ImageInfo[currentImage].Regions.length; i += 1 ) {
        if( ImageInfo[currentImage].Regions[i].uid === uid ) {
            if( debug > 2 ) { console.log( "region " + ImageInfo[currentImage].Regions[i].uid + ": " ); }
            if( debug > 2 ) { console.log( ImageInfo[currentImage].Regions[i] ); }

            return ImageInfo[currentImage].Regions[i];
        }
    }
    console.log("Region with unique ID " + uid + " not found");

    return null;
}

/**
 * @function regionTag
 * @param String name
 * @param Number uid
 */
function regionTag(name, uid) {
    //if( debug ) console.log("> regionTag");

    var str;
    var color = regionHashColor(name);
    if( uid ) {
        var reg = findRegionByUID(uid);
        var mult = 1.0;
        if( reg ) {
            mult = 255;
            color = reg.path.fillColor;
        } else {
            color = regionHashColor(name);
        }
        str = [
                "<div class='region-tag' id='" + uid + "' style='padding:2px'>",
                "<img class='eye' title='Region visible' id='eye_" + uid + "' src='img/eyeOpened.svg' />",
                "<div class='region-color'",
                "style='background-color:rgba(",
                parseInt(color.red*mult, 10),
                ",",
                parseInt(color.green*mult, 10),
                ",",
                parseInt(color.blue*mult, 10),
                ",0.67)'></div>",
                "<span class='region-name'>" + name + "</span>",
                "</div>"
        ].join(" ");
    } else {
        color = regionHashColor(name);
        str = [
                "<div class='region-tag' style='padding:2px'>",
                "<div class='region-color'",
                "style='background-color:rgba(",
                color.red,
                ",",
                color.green,
                ",",
                color.blue,
                ",0.67)'></div>",
                "<span class='region-name'>" + name + "</span>",
                "</div>"
        ].join(" ");
    }

    return str;
}

/**
 * @function selectRegion
 * @desc Make the region selected
 * @param Object reg The region to select.
 * @this
 */
function selectRegion(reg) {
    if( debug ) { console.log("> selectRegion"); }

    var i;

    // Select path
    for( i = 0; i < ImageInfo[currentImage].Regions.length; i += 1 ) {
        if( ImageInfo[currentImage].Regions[i] == reg ) {
            reg.path.selected = true;
            reg.path.fullySelected = true;
            region = reg;
        } else {
            ImageInfo[currentImage].Regions[i].path.selected = false;
            ImageInfo[currentImage].Regions[i].path.fullySelected = false;
        }
    }
    paper.view.draw();

    // Select region name in list
    $("#regionList > .region-tag").each(function () {
        $(this).addClass("deselected");
        $(this).removeClass("selected");
    });

    var tag = $("#regionList > .region-tag#" + reg.uid);
    $(tag).removeClass("deselected");
    $(tag).addClass("selected");

    if(debug) { console.log("< selectRegion"); }
}

/**
 * @function singlePressOnRegion
 */
function singlePressOnRegion(event) {
    if( debug ) {
        console.log("> singlePressOnRegion");
    }

    event.stopPropagation();
    event.preventDefault();

    var el = $(this);
    var reg;
    var uid;

    if( debug ) {
        console.log(event);
    }
    if( event.clientX > 20 ) {
        if( event.clientX > 50 ) {

            if( el.hasClass("ontology") ) {
                // Click on regionPicker (ontology selection list)
                var newName = el.find(".region-name").text();
                uid = $(".region-tag.selected").attr('id');
                reg = findRegionByUID(uid);
                changeRegionName(reg, newName);
                $("div#regionPicker").appendTo($("body")).hide();
            } else {
                // Click on regionList (list or annotated regions)
                uid = $(this).attr('id');
                reg = findRegionByUID(uid);
                if( reg ) {
                    selectRegion(reg);
                } else { console.log("region undefined"); }
            }
        } else {
            reg = findRegionByUID(this.id);
            if( reg.path.fillColor !== null ) {
                if( reg ) {
                    selectRegion(reg);
                }
                annotationStyle(reg);
            }
        }
    } else {
        reg = findRegionByUID(this.id);
        toggleRegion(reg);
    }
}

/**
 * @function doublePressOnRegion
 */
function doublePressOnRegion(event) {
    if( debug ) {
        console.log("> doublePressOnRegion");
    }

    var reg;
    var name;

    event.stopPropagation();
    event.preventDefault();

    if( event.clientX > 20 ) {
        if( event.clientX > 50 )    {
            if( config.drawingEnabled ) {
                if( config.regionOntology == true ) {
                    regionPicker(this);
                } else {
                    name = prompt("Region name", findRegionByUID(this.id).name);
                    if( name != null ) {
                        changeRegionName(findRegionByUID(this.id), name);
                    }
                }
            }
        } else {
            reg = findRegionByUID(this.id);
            if( reg.path.fillColor != null ) {
                if( reg ) {
                    selectRegion(reg);
                }
                annotationStyle(reg);
            }
        }
    } else {
        reg = findRegionByUID(this.id);
        toggleRegion(reg);
    }
}

/**
 * @function newRegion
 * @desc  Create a new region
 * @param Object arg An object containing the name of the region (arg.name) and the path data (arg.path)
 * @param Integer imageNumber The number of the image where the region will be created
 */
function newRegion(arg, imageNumber) {
    if( debug ) {
        console.log("> newRegion");
    }
    var reg = {};

    reg.uid = regionUID();
    if( arg.name ) {
        reg.name = arg.name;
    } else {
        reg.name = "Untitled " + reg.uid;
    }

    var color = regionHashColor(reg.name);

    if( arg.path ) {
        reg.path = arg.path;
        reg.path.strokeWidth = arg.path.strokeWidth ? arg.path.strokeWidth : config.defaultStrokeWidth;
        reg.path.strokeColor = arg.path.strokeColor ? arg.path.strokeColor : config.defaultStrokeColor;
        reg.path.strokeScaling = false;
        reg.path.fillColor = arg.path.fillColor ? arg.path.fillColor :'rgba(' + color.red + ',' + color.green + ',' + color.blue + ',' + config.defaultFillAlpha + ')';
        reg.path.selected = false;
    }

    if( imageNumber === undefined ) {
        imageNumber = currentImage;
    }
    if( imageNumber === currentImage ) {
        // append region tag to regionList
        var el = $(regionTag(reg.name, reg.uid));
        $("#regionList").append(el);

        // handle single click on computers
        el.click(singlePressOnRegion);

        // handle double click on computers
        el.dblclick(doublePressOnRegion);

        // handle single and double tap on touch devices
        /**
         * @todo it seems that a click event is also fired on touch devices, making this one redundant
         */

        el.on("touchstart", handleRegionTap);
    }

    // Select region name in list
    $("#regionList > .region-tag").each(function (i) {
        $(this).addClass("deselected");
        $(this).removeClass("selected");
    });

    var tag = $("#regionList > .region-tag#" + reg.uid);
    $(tag).removeClass("deselected");
    $(tag).addClass("selected");

    // push the new region to the Regions array
    ImageInfo[imageNumber].Regions.push(reg);

    return reg;
}

/**
 * @function removeRegion
 * @desc Remove region from current image
 * @param Object reg The region is going to be removed by this function
 * @param Integer imageNumber The number of the image where the region will be removed
 */
function removeRegion(reg, imageNumber) {
    if( debug ) { console.log("> removeRegion"); }

    if( imageNumber === undefined ) {
        imageNumber = currentImage;
    }

    // remove from Regions array
    ImageInfo[imageNumber].Regions.splice(ImageInfo[imageNumber].Regions.indexOf(reg), 1);
    // remove from paths
    reg.path.remove();
    if( imageNumber == currentImage ) {
        // remove from regionList
        var tag = $("#regionList > .region-tag#" + reg.uid);
        $(tag).remove();
    }
}

/**
 * @function findRegionByName
 */
function findRegionByName(name) {
    if( debug ) { console.log("> findRegionByName"); }

    var i;
    for( i = 0; i < ImageInfo[currentImage].Regions.length; i += 1 ) {
        if( ImageInfo[currentImage].Regions[i].name == name ) {
            return ImageInfo[currentImage].Regions[i];
        }
    }
    console.log("Region with name " + name + " not found");

    return null;
}

/**
 * @function appendRegionTagsFromOntology
 */
function appendRegionTagsFromOntology(o) {
    if( debug ) { console.log("> appendRegionTagsFromOntology"); }

    for( var i = 0; i < o.length; i += 1 ) {
        if( o[i].parts ) {
            $("#regionPicker").append("<div>" + o[i].name + "</div>");
            appendRegionTagsFromOntology(o[i].parts);
        } else {
            var tag = regionTag(o[i].name);
            var el = $(tag).addClass("ontology");
            $("#regionPicker").append(el);

            // handle single click on computers
            el.click(singlePressOnRegion);

            // handle double click on computers
            el.dblclick(doublePressOnRegion);

            el.on("touchstart", handleRegionTap);
        }
    }
}

/**
 * @function regionPicker
 */
function regionPicker(parent) {
    if( debug ) { console.log("> regionPicker"); }

    $("div#regionPicker").appendTo("body");
    $("div#regionPicker").show();
}

/**
 * @function changeRegionName
 */
function changeRegionName(reg, name) {
    if( debug ) { console.log("> changeRegionName"); }

    var i;
    var color = regionHashColor(name);

    // Update path
    reg.name = name;
    reg.path.fillColor = 'rgba(' + color.red + ',' + color.green + ',' + color.blue + ',0.5)';
    paper.view.draw();

    // Update region tag
    $(".region-tag#" + reg.uid + ">.region-name").text(name);
    $(".region-tag#" + reg.uid + ">.region-color").css('background-color', 'rgba(' + color.red + ',' + color.green + ',' + color.blue + ',0.67)');
}

/**
 * @function toggleRegion
 * @desc Toggle the visibility of a region
 */
function toggleRegion(reg) {
    if( region !== null ) {
        if( debug ) { console.log("> toggle region"); }

        var color = regionHashColor(reg.name);
        if( reg.path.fillColor !== null ) {
            reg.path.storeColor = reg.path.fillColor;
            reg.path.fillColor = null;

            reg.path.strokeWidth = 0;
            reg.path.fullySelected = false;
            reg.storeName = reg.name;
            //reg.name=reg.name + '*';
            $('#eye_' + reg.uid).attr('src', 'img/eyeClosed.svg');
        } else {
            reg.path.fillColor = reg.path.storeColor;
            reg.path.strokeWidth = 1;
            reg.name = reg.storeName;
            $('#eye_' + reg.uid).attr('src', 'img/eyeOpened.svg');
        }
        paper.view.draw();
        $(".region-tag#" + reg.uid + ">.region-name").text(reg.name);
    }
}

/**
 * @function updateRegionList
 */
function updateRegionList() {
    if( debug ) { console.log("> updateRegionList"); }

    // remove all entries in the regionList
    $("#regionList > .region-tag").each(function() {
        $(this).remove();
    });

    // adding entries corresponding to the currentImage
    for( var i = 0; i < ImageInfo[currentImage].Regions.length; i += 1 ) {
        var reg = ImageInfo[currentImage].Regions[i];
        // append region tag to regionList
        var el = $(regionTag(reg.name, reg.uid));
        $("#regionList").append(el);

        // handle single click on computers
        el.click(singlePressOnRegion);
        // handle double click on computers
        el.dblclick(doublePressOnRegion);
        // handle single and double tap on touch devices
        el.on("touchstart", handleRegionTap);
    }
}

/**
 * @function checkRegionSize
 */
function checkRegionSize(reg) {
    if( reg.path.length > 3 ) {

    } else {
        removeRegion(region, currentImage);
    }
}


/**
 * @function clickHandler
 * @desc Interaction: mouse and tap
 */
function clickHandler(event) {
    if( debug ) { console.log("> clickHandler"); }

    event.stopHandlers = !navEnabled;
    if( selectedTool == "draw" ) {
        checkRegionSize(region);
    }
}

/**
 * @function pressHandler
 */
function pressHandler(event) {
    if( debug ) { console.log("> pressHandler"); }

    if( !navEnabled ) {
        event.stopHandlers = true;
        mouseDown(event.originalEvent.layerX, event.originalEvent.layerY);
    }
}

/**
 * @function dragHandler
 */
function dragHandler(event) {
    if( debug > 1 ) { console.log("> dragHandler"); }

    if( !navEnabled ) {
        event.stopHandlers = true;
        mouseDrag(event.originalEvent.layerX, event.originalEvent.layerY, event.delta.x, event.delta.y);
    }
}

/**
 * @function dragEndHandler
 */
function dragEndHandler(event) {
    if( debug ) { console.log("> dragEndHandler"); }

    if( !navEnabled ) {
        event.stopHandlers = true;
        mouseUp();
    }
}

var tap = false;

/**
 * @function handleRegionTap
 */
function handleRegionTap(event) {

/*
    Handles single and double tap in touch devices
*/
    if( debug ) { console.log("> handleRegionTap"); }

    var caller = this;

    if( !tap ) { //if tap is not set, set up single tap
        tap = setTimeout(function() {
            tap = null;
        }, 300);

        // call singlePressOnRegion(event) using 'this' as context
        singlePressOnRegion.call(this, event);
    } else {
        clearTimeout(tap);
        tap = null;

        // call doublePressOnRegion(event) using 'this' as context
        doublePressOnRegion.call(this, event);
    }
    if( debug ) { console.log("< handleRegionTap"); }
}

/**
 * @function mouseDown
 */
function mouseDown(x, y) {
    if( debug > 1 ) { console.log("> mouseDown"); }

    mouseUndo = getUndo();
    var prevRegion = null;
    var point = paper.view.viewToProject(new paper.Point(x, y));
    var hitResult;

    handle = null;

    switch( selectedTool ) {
        case "select":
        case "addpoint":
        case "delpoint":
        case "addregion":
        case "delregion":
        case "splitregion": {
            hitResult = paper.project.hitTest(point, {
                    tolerance: tolerance,
                    stroke: true,
                    segments: true,
                    fill: true,
                    handles: true
                });

            newRegionFlag = false;
            if( hitResult ) {
                var i, re;
                for( i = 0; i < ImageInfo[currentImage].Regions.length; i += 1 ) {
                    if( ImageInfo[currentImage].Regions[i].path == hitResult.item ) {
                        re = ImageInfo[currentImage].Regions[i];
                        break;
                    }
                }

                // select path
                if( region && region != re ) {
                    region.path.selected = false;
                    prevRegion = region;
                }
                selectRegion(re);

                if( hitResult.type == 'handle-in' ) {
                    handle = hitResult.segment.handleIn;
                    handle.point = point;
                } else if( hitResult.type == 'handle-out' ) {
                    handle = hitResult.segment.handleOut;
                    handle.point = point;
                } else if( hitResult.type == 'segment' ) {
                    if( selectedTool == "select" ) {
                        handle = hitResult.segment.point;
                        handle.point = point;
                    }
                    if( selectedTool == "delpoint" ) {
                        hitResult.segment.remove();
                        commitMouseUndo();
                    }
                } else if( hitResult.type == 'stroke' && selectedTool == "addpoint" ) {
                    region.path
                    .curves[hitResult.location.index]
                    .divide(hitResult.location);
                    region.path.fullySelected = true;
                    commitMouseUndo();
                    paper.view.draw();
                } else if( selectedTool == "addregion" ) {
                    if( prevRegion ) {
                        var newPath = region.path.unite(prevRegion.path);
                        removeRegion(prevRegion);
                        region.path.remove();
                        region.path = newPath;
                        updateRegionList();
                        selectRegion(region);
                        paper.view.draw();
                        commitMouseUndo();
                        backToSelect();
                    }
                } else if( selectedTool == "delregion" ) {
                    if( prevRegion ) {
                        var newPath = prevRegion.path.subtract(region.path);
                        removeRegion(prevRegion);
                        prevRegion.path.remove();
                        newRegion({path:newPath});
                        updateRegionList();
                        selectRegion(region);
                        paper.view.draw();
                        commitMouseUndo();
                        backToSelect();
                    }
                } else if( selectedTool == "splitregion" ) {

                    /*selected region is prevRegion!
                    region is the region that should be split based on prevRegion
                    newRegionPath is outlining that part of region which has not been overlaid by prevRegion
                    i.e. newRegion is what was region
                    and prevRegion color should go to the other part*/
                    if( prevRegion ) {
                        var prevColor = prevRegion.path.fillColor;
                        //color of the overlaid part
                        var color = region.path.fillColor;
                        var newPath = region.path.divide(prevRegion.path);

                        removeRegion(prevRegion);
                        region.path.remove();

                        region.path = newPath;
                        var newReg;
                        for( i = 0; i < newPath._children.length; i += 1 ) {
                            if( i == 0 ) {
                                region.path = newPath._children[i];
                            } else {
                                newReg = newRegion({path:newPath._children[i]});
                            }
                        }
                        region.path.fillColor = color;
                        if( newReg ) {
                            newReg.path.fillColor = prevColor;
                        }
                        updateRegionList();
                        selectRegion(region);
                        paper.view.draw();

                        commitMouseUndo();
                        backToSelect();
                    }
                }
                break;
            }
            if( hitResult == null && region ) {
                //deselect paths
                region.path.selected = false;
                region = null;
            }
            break;
        }
        case "draw": {
            // Start a new region
            // if there was an older region selected, unselect it
            if( region ) {
                region.path.selected = false;
            }
            // start a new region
            var path = new paper.Path({segments:[point]});
            path.strokeWidth = config.defaultStrokeWidth;
            region = newRegion({path:path});
            // signal that a new region has been created for drawing
            newRegionFlag = true;

            commitMouseUndo();
            break;
        }
        case "draw-polygon": {
            // is already drawing a polygon or not?
            if( drawingPolygonFlag == false ) {
                // deselect previously selected region
                if( region ) { region.path.selected = false; }

                // Start a new Region with alpha 0
                var path = new paper.Path({segments:[point]});
                path.strokeWidth = config.defaultStrokeWidth;
                region = newRegion({path:path});
                region.path.fillColor.alpha = 0;
                region.path.selected = true;
                drawingPolygonFlag = true;
                commitMouseUndo();
            } else {
                hitResult = paper.project.hitTest(point, {tolerance:tolerance, segments:true});
                if( hitResult && hitResult.item == region.path && hitResult.segment.point == region.path.segments[0].point ) {
                    // clicked on first point of current path
                    // --> close path and remove drawing flag
                    finishDrawingPolygon(true);
                } else {
                    // add point to region
                    region.path.add(point);
                    commitMouseUndo();
                }
            }
            break;
        }
        case "rotate":
            region.origin = point;
            break;
    }
    paper.view.draw();
}

/**
 * @function mouseDrag
 */
function mouseDrag(x, y, dx, dy) {
    //if( debug ) console.log("> mouseDrag");

    // transform screen coordinate into world coordinate
    var point = paper.view.viewToProject(new paper.Point(x, y));

    // transform screen delta into world delta
    var orig = paper.view.viewToProject(new paper.Point(0, 0));
    var dpoint = paper.view.viewToProject(new paper.Point(dx, dy));
    dpoint.x -= orig.x;
    dpoint.y -= orig.y;

    if( handle ) {
        handle.x += point.x-handle.point.x;
        handle.y += point.y-handle.point.y;
        handle.point = point;
        commitMouseUndo();
    } else
    if( selectedTool == "draw" ) {
        region.path.add(point);
    } else
    if( selectedTool == "select" ) {
        // event.stopHandlers = true;
        for( i in ImageInfo[currentImage].Regions ) {
            var reg = ImageInfo[currentImage].Regions[i];
            if( reg.path.selected ) {
                reg.path.position.x += dpoint.x;
                reg.path.position.y += dpoint.y;
                commitMouseUndo();
            }
        }
    }
    if( selectedTool == "rotate" ) {
        event.stopHandlers = true;
        var degree = parseInt(dpoint.x, 10);
        var i;
        for( i in ImageInfo[currentImage].Regions ) {
            if( ImageInfo[currentImage].Regions[i].path.selected ) {
                ImageInfo[currentImage].Regions[i].path.rotate(degree, region.origin);
                commitMouseUndo();
            }
        }
    }
    paper.view.draw();
}

/**
 * @function mouseUp
 */
function mouseUp() {
    if( debug ) { console.log("> mouseUp"); }

    if( newRegionFlag == true ) {
        region.path.closed = true;
        region.path.fullySelected = true;
        // to delete all unnecessary segments while preserving the form of the region to make it modifiable; & adding handles to the segments
        var orig_segments = region.path.segments.length;

        var z = viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom(true));
        z = 3*Math.pow(10, z);
        region.path.scale(z, z);
        region.path.simplify(0);
        region.path.scale(1/z, 1/z);

        var final_segments = region.path.segments.length;
        if( debug > 2 ) { console.log( parseInt(final_segments/orig_segments*100, 10) + "% segments conserved" ); }
    }
    paper.view.draw();
}

/**
 * @function simplify
 * @desc Simplify the region path
 */

function simplify() {
    if( region !== null ) {
        if( debug ) { console.log("> simplifying region path"); }

        var orig_segments = region.path.segments.length;
        region.path.simplify();
        var final_segments = region.path.segments.length;
        console.log( parseInt(final_segments/orig_segments*100, 10) + "% segments conserved" );
        paper.view.draw();
    }
}

/**
 * @function flipRegion
 * @desc Flip region along y-axis around its center point
 */

function flipRegion(reg) {
    if( region !== null ) {
        if( debug ) { console.log("> flipping region"); }

        var i;
        for( i in ImageInfo[currentImage].Regions ) {
            if( ImageInfo[currentImage].Regions[i].path.selected ) {
                ImageInfo[currentImage].Regions[i].path.scale(-1, 1);
            }
        }
        paper.view.draw();
    }
}


/**
 * @function bezierToPolygon
 * @desc converts bezier curve into polygon
 */
 
function bezierToPolygon() {
    console.log("> bezierToPolygon");
    if (region != null) {
        if (region.path.hasHandles()) {
            if (confirm('Convert bezier curve into polygon?')) {
                var undoInfo = getUndo();
                region.path.clearHandles();
                saveUndo(undoInfo);
            }
        } else {
            return;
        }
        paper.view.draw();
    }
}

/**
 * @function polygonToBezier
 * @desc converts polygon into bezier curve
 */

function polygonToBezier() {
    console.log("> polygonToBezier");
    if (region != null) {
        if (region.path.hasHandles()) {
            return;
        }
        else {
            var undoInfo = getUndo();
            region.path.smooth();
            saveUndo(undoInfo);
        }
        paper.view.draw();
    }
}


/***
    the following functions serve changing the annotation style
***/
var currentColorRegion;

/**
 * @function pad
 * @desc Add leading zeros
 */

function pad(number, length) {
    var str = String(number);
    while( str.length < length ) { str = '0' + str; }

    return str;
}

/**
 * @function annotationStyle
 * @desc Get current alpha & color values for colorPicker display
 */

function annotationStyle(reg) {
    if( debug ) { console.log(reg.path.fillColor); }

    if( region !== null ) {
        if( debug ) { console.log("> changing annotation style"); }

        currentColorRegion = reg;
        var alpha = reg.path.fillColor.alpha;
        $('#alphaSlider').val(alpha*100);
        $('#alphaFill').val(parseInt(alpha*100), 10);

        var hexColor = '#'
            + pad(( parseInt(reg.path.fillColor.red * 255, 10) ).toString(16), 2)
            + pad(( parseInt(reg.path.fillColor.green * 255, 10) ).toString(16), 2)
            + pad(( parseInt(reg.path.fillColor.blue * 255, 10) ).toString(16), 2);
        if( debug ) {
            console.log(hexColor);
        }

        $('#fillColorPicker').val( hexColor );

        if( $('#colorSelector').css('display') == 'none' ) {
            $('#colorSelector').css('display', 'block');
        } else {
            $('#colorSelector').css('display', 'none');
        }
    }
}

/**
 * @function setRegionColor
 * @desc Set picked color & alpha
 */

function setRegionColor() {
    var reg = currentColorRegion;
    var hexColor = $('#fillColorPicker').val();
    var red = parseInt( hexColor.substring(1, 3), 16 );
    var green = parseInt( hexColor.substring(3, 5), 16 );
    var blue = parseInt( hexColor.substring(5, 7), 16 );

    reg.path.fillColor.red = red / 255;
    reg.path.fillColor.green = green / 255;
    reg.path.fillColor.blue = blue / 255;
    reg.path.fillColor.alpha = $('#alphaSlider').val() / 100;

    // update region tag
    $(".region-tag#" + reg.uid + ">.region-color").css(
        'background-color',
        'rgba(' + red + ',' + green + ',' + blue + ',0.67)'
    );

    // update stroke color
    switch( $('#selectStrokeColor')[0].selectedIndex ) {
        case 0:
            reg.path.strokeColor = "black";
            break;
        case 1:
            reg.path.strokeColor = "white";
            break;
        case 2:
            reg.path.strokeColor = "red";
            break;
        case 3:
            reg.path.strokeColor = "green";
            break;
        case 4:
            reg.path.strokeColor = "blue";
            break;
        case 5:
            reg.path.strokeColor = "yellow";
            break;
    }
    $('#colorSelector').css('display', 'none');
}

/**
 * @function onFillColorPicker
 * @desc Update all values on the fly
 */

function onFillColorPicker(value) {
    $('#fillColorPicker').val(value);
    var reg = currentColorRegion;
    var hexColor = $('#fillColorPicker').val();
    var red = parseInt( hexColor.substring(1, 3), 16 );
    var green = parseInt( hexColor.substring(3, 5), 16);
    var blue = parseInt( hexColor.substring(5, 7), 16);
    reg.path.fillColor.red = red / 255;
    reg.path.fillColor.green = green / 255;
    reg.path.fillColor.blue = blue / 255;
    reg.path.fillColor.alpha = $('#alphaSlider').val() / 100;
    paper.view.draw();
}

/**
 * @function onSelectStrokeColor
 */
function onSelectStrokeColor() {
    var reg = currentColorRegion;
    switch( $('#selectStrokeColor')[0].selectedIndex ) {
        case 0:
            reg.path.strokeColor = "black";
            break;
        case 1:
            reg.path.strokeColor = "white";
            break;
        case 2:
            reg.path.strokeColor = "red";
            break;
        case 3:
            reg.path.strokeColor = "green";
            break;
        case 4:
            reg.path.strokeColor = "blue";
            break;
        case 5:
            reg.path.strokeColor = "yellow";
            break;
    }
    paper.view.draw();
}

/**
 * @function onAlphaSlider
 */
function onAlphaSlider(value) {
    $('#alphaFill').val(value);
    var reg = currentColorRegion;
    reg.path.fillColor.alpha = $('#alphaSlider').val() / 100;
    paper.view.draw();
}

/**
 * @function onAlphaInput
 */
function onAlphaInput(value) {
    $('#alphaSlider').val(value);
    var reg = currentColorRegion;
    reg.path.fillColor.alpha = $('#alphaSlider').val() / 100;
    paper.view.draw();
}

/**
 * @function onStrokeWidthDec
 */
function onStrokeWidthDec() {
    var reg = currentColorRegion;
    reg.path.strokeWidth = Math.max(region.path.strokeWidth - 1, 1);
    paper.view.draw();
}

/**
 * @function onStrokeWidthInc
 */
function onStrokeWidthInc() {
    var reg = currentColorRegion;
    reg.path.strokeWidth = Math.min(region.path.strokeWidth + 1, 10);
    paper.view.draw();
}

/*** UNDO ***/

/**
 * @function cmdUndo
 * @desc Command to actually perform an undo.
 */

function cmdUndo() {
    if( UndoStack.length > 0 ) {
        var redoInfo = getUndo();
        var undoInfo = UndoStack.pop();
        applyUndo(undoInfo);
        RedoStack.push(redoInfo);
        paper.view.draw();
    }
}

/**
 * @function cmdRedo
 * @desc Command to actually perform a redo.
 */

function cmdRedo() {
    if( RedoStack.length > 0 ) {
        var undoInfo = getUndo();
        var redoInfo = RedoStack.pop();
        applyUndo(redoInfo);
        UndoStack.push(undoInfo);
        paper.view.draw();
    }
}

/**
 * @function getUndo
 * @desc Return a complete copy of the current state as an undo object.
 */

function getUndo() {
    var undo = { imageNumber: currentImage, regions: [], drawingPolygonFlag: drawingPolygonFlag };
    var info = ImageInfo[currentImage].Regions;

    for( var i = 0; i < info.length; i += 1 ) {
        var el = {
            json: JSON.parse(info[i].path.exportJSON()),
            name: info[i].name,
            selected: info[i].path.selected,
            fullySelected: info[i].path.fullySelected
        };
        undo.regions.push(el);
    }

return undo;
}

/**
 * @function saveUndo
 * @desc Save an undo object. This has the side-effect of initializing the redo stack.
 */

function saveUndo(undoInfo) {
    UndoStack.push(undoInfo);
    RedoStack = [];
}

/**
 * @function setImage
 */
function setImage(imageNumber) {
    if( debug ) { console.log("> setImage"); }
    var index = imageOrder.indexOf(imageNumber);

    // update image slider
    updateSliderValue(index);

    loadImage(imageOrder[index]);
}

/**
 * @function applyUndo
 * @desc Restore the current state from an undo object.
 */

function applyUndo(undo) {
    if( undo.imageNumber !== currentImage ) {
        setImage(undo.imageNumber);
    }
    var info = ImageInfo[undo.imageNumber].Regions;
    while( info.length > 0 ) {
        removeRegion(info[0], undo.imageNumber);
    }
    region = null;
    var reg;
    for( var i = 0; i < undo.regions.length; i += 1 ) {
        var el = undo.regions[i];
        var project = paper.projects[ImageInfo[undo.imageNumber].projectID];

        /* Create the path and add it to a specific project.
        */

        var path = new paper.Path();
        project.addChild(path);
        path.importJSON(el.json);
        reg = newRegion({name:el.name, path:path}, undo.imageNumber);
        // here order matters. if fully selected is set after selected, partially selected paths will be incorrect
          reg.path.fullySelected = el.fullySelected;
         reg.path.selected = el.selected;
        if( el.selected ) {
            if( region === null ) {
                region = reg;
            } else {
                console.log("Should not happen: two regions selected?");
            }
        }
    }
    drawingPolygonFlag = undo.drawingPolygonFlag;
}

/**
 * @function commitMouseUndo
 * @desc If we have actually made a change with a mouse operation, commit the undo information.
 */

function commitMouseUndo() {
    if( mouseUndo !== null ) {
        saveUndo(mouseUndo);
        mouseUndo = null;
    }
}


/**
 * @function finishDrawingPolygon
 * @desc Tool selection
 */

function finishDrawingPolygon(closed) {
        // finished the drawing of the polygon
        if( closed == true ) {
            region.path.closed = true;
            region.path.fillColor.alpha = config.defaultFillAlpha;
        } else {
            region.path.fillColor.alpha = 0;
        }
        region.path.fullySelected = true;
        //region.path.smooth();
        drawingPolygonFlag = false;
        commitMouseUndo();
}

/**
 * @function backToPreviousTool
 */
function backToPreviousTool(prevTool) {
    setTimeout(function() {
        selectedTool = prevTool;
        selectTool();
    }, 500);
}

/**
 * @function backToSelect
 */
function backToSelect() {
    setTimeout(function() {
        selectedTool = "select";
        selectTool();
    }, 500);
}

/**
 * @function cmdDeleteSelected
 * @desc This function deletes the currently selected object.
 */

function cmdDeleteSelected() {
    var undoInfo = getUndo();
    var i;
    for( i in ImageInfo[currentImage].Regions ) {
        if( ImageInfo[currentImage].Regions[i].path.selected ) {
            removeRegion(ImageInfo[currentImage].Regions[i]);
            saveUndo(undoInfo);
            paper.view.draw();
            break;
        }
    }
}

/**
 * @function cmdPaste
 */
function cmdPaste() {
    if( copyRegion !== null ) {
        var undoInfo = getUndo();
        saveUndo(undoInfo);
        console.log( "paste " + copyRegion.name );
        if( findRegionByName(copyRegion.name) ) {
            copyRegion.name += " Copy";
        }
        var reg = JSON.parse(JSON.stringify(copyRegion));
        reg.path = new paper.Path();
        reg.path.importJSON(copyRegion.path);
        reg.path.fullySelected = true;
        var color = regionHashColor(reg.name);
        reg.path.fillColor = 'rgba(' + color.red + ',' + color.green + ',' + color.blue + ',0.5)';
        newRegion({name:copyRegion.name, path:reg.path});
    }
    paper.view.draw();
}

/**
 * @function cmdCopy
 */
function cmdCopy() {
    if( region !== null ) {
    var json = region.path.exportJSON();
    copyRegion = JSON.parse(JSON.stringify(region));
    copyRegion.path = json;
    console.log( "< copy " + copyRegion.name );
    }
}

/**
 * @function toolSelection
 */
function toolSelection(event) {
    if( debug ) { console.log("> toolSelection"); }

    //end drawing of polygons and make open form
    if( drawingPolygonFlag == true ) { finishDrawingPolygon(true); }

    var prevTool = selectedTool;
    selectedTool = $(this).attr("id");
    selectTool();

    switch(selectedTool) {
        case "select":
        case "addpoint":
        case "delpoint":
        case "addregion":
        case "delregion":
        case "draw":
        case "rotate":
        case "draw-polygon":
            navEnabled = false;
            break;
        case "zoom":
            navEnabled = true;
            handle = null;
            break;
        case "delete":
            cmdDeleteSelected();
            backToPreviousTool(prevTool);
            break;
        case "save":
            microdrawDBSave();
            backToPreviousTool(prevTool);
            break;
        case "zoom-in":
        case "zoom-out":
        case "home":
            backToPreviousTool(prevTool);
            break;
        case "prev":
            loadPreviousImage();
            backToPreviousTool(prevTool);
            break;
        case "next":
            loadNextImage();
            backToPreviousTool(prevTool);
            break;
        case "copy":
            cmdCopy();
            //backToPreviousTool(prevTool);
            backToSelect();
            break;
        case "paste":
            cmdPaste();
            //backToPreviousTool(prevTool);
            backToSelect();
            break;
        case "simplify":
            simplify(region);
            //backToPreviousTool(prevTool);
            backToSelect();
            break;
        case "flip":
            flipRegion(region);
            //backToPreviousTool(prevTool);
            backToSelect();
            break;
        case "closeMenu":
            toggleMenu();
            backToPreviousTool(prevTool);
            break;
        case "openMenu":
            toggleMenu();
            backToPreviousTool(prevTool);
            break;
        case "toPolygon":
            bezierToPolygon();
            backToPreviousTool(prevTool);
            break;
        case "toBezier":
            polygonToBezier();
            backToPreviousTool(prevTool);
            break;
        case "screenshot":
            viewer.screenshotInstance.toggleScreenshotMenu();
            backToPreviousTool(prevTool);
            break;
    }
}

/**
 * @function selectTool
 */
function selectTool() {
    if( debug ) { console.log("> selectTool"); }

    $("img.button").removeClass("selected");
    $("img.button#" + selectedTool).addClass("selected");
    //$("svg").removeClass("selected");
    //$("svg#" + selectedTool).addClass("selected");
}


/*
 Annotation storage
*/

/**
 * @function microdrawDBSave
 * @desc MicroDraw database push
 */
function microdrawDBSave() {

/*
    Save SVG overlay to microdrawDB
*/
    if( debug ) { console.log("> save promise"); }

    // key
    var key = "regionPaths";
    var savedSlices = "Saving slices: ";

    for( var sl in ImageInfo ) {
        if ((config.multiImageSave == false) && (sl != currentImage)) {
            continue;
        }
        // configure value to be saved
        var slice = ImageInfo[sl];
        var value = {};
        value.Regions = [];
        for( var i = 0; i < slice.Regions.length; i += 1 ) {
            var el = {};
            el.path = JSON.parse(slice.Regions[i].path.exportJSON());
            el.name = slice.Regions[i].name;
            value.Regions.push(el);
        }

        // check if the slice annotations have changed since loaded by computing a hash
        var h = hash(JSON.stringify(value.Regions)).toString(16);
        if( debug > 1 ) { console.log("hash:", h, "original hash:", slice.Hash); }
        // if the slice hash is undefined, this slice has not yet been loaded. do not save anything for this slice
        if( slice.Hash == undefined || h == slice.Hash ) {
            if( debug > 1 ) { console.log("No change, no save"); }
            value.Hash = h;
            continue;
        }
        value.Hash = h;
        savedSlices += sl.toString() + " ";

        // post data to database
        (function(sl, h) {
        console.log('saving slice ', sl);
        var data = {
                action: "save",
                source: source,
                 slice: sl,
                   key: key,
                 value: JSON.stringify(value)
        };
        $.ajax({
            url:dbroot,
            type:"POST",
            data: data,
            success: function(data) {
                console.log("< microdrawDBSave resolve: Successfully saved regions:", ImageInfo[sl].Regions.length, "slice: " + sl.toString(), "response:", data);
                //update hash
                ImageInfo[sl].Hash = h;
            },
            error: function(jqXHR, textStatus, errorThrown) {
                console.log("< microdrawDBSave resolve: ERROR: " + textStatus + " " + errorThrown, "slice: " + sl.toString());
            }
        });
        }(sl, h));

        //show dialog box with timeout
        $('#saveDialog').html(savedSlices)
.fadeIn();
        setTimeout(function() { $("#saveDialog").fadeOut(500); }, 2000);
    }
}

/**
 * @function microdrawDBLoad
 */
function microdrawDBLoad() {

/*
    Load SVG overlay from microdrawDB
*/
    if( debug ) { console.log("> microdrawDBLoad promise"); }

    var def = $.Deferred();
    var key = "regionPaths";

    $.get(dbroot, {
        action:"load_last",
        source:source,
        slice: slice,
        key:key
    }).success(function (data) {
        var i, obj, reg;

        console.log("INSIDE!!!");
        annotationLoadingFlag = false;

        // Because of asynchrony, the slice that just loaded may not be the one that the user
        // intended to get. If the slice that was just loaded does not correspond to the current slice,
        // do not display this one and load the current slice.
        if( slice != currentImage ) {
            microdrawDBLoad()
            .then(function() {
                $("#regionList").height($(window).height()-$("#regionList").offset().top);
                updateRegionList();
                paper.view.draw();
            });
            def.fail();

return;
        }

        // if there is no data on the current slice
        // save hash for the image none the less
        if( $.isEmptyObject(data) ) {
            ImageInfo[currentImage].Hash = hash(JSON.stringify(ImageInfo[currentImage].Regions)).toString(16);

return;
        }

        // parse the data and add to the current canvas
        console.log("[", data, "]");
        //obj = JSON.parse(data);
        //obj = data;
        //if( obj ) {
        for( i = 0; i < data.Regions.length; i += 1 ) {
            var reg = {};
            var json;
            reg.name = data.Regions[i].name;
            reg.page = data.Regions[i].page;
            json = data.Regions[i].path;
            reg.path = new paper.Path();
            reg.path.importJSON(json);
            newRegion({name:reg.name, path:reg.path});
        }
        paper.view.draw();
        // if image has no hash, save one
        ImageInfo[currentImage].Hash = (data.Hash ? data.Hash : hash(JSON.stringify(ImageInfo[currentImage].Regions)).toString(16));


        if( debug ) { console.log("< microdrawDBLoad resolve success. Number of regions:", ImageInfo[currentImage].Regions.length); }
        def.resolve();
    })
.error(function(jqXHR, textStatus, errorThrown) {
        console.log("< microdrawDBLoad resolve ERROR: " + textStatus + " " + errorThrown);
        annotationLoadingFlag = false;
    });

return def.promise();
}

/*
    Get my IP
*/
/*
function microdrawDBIP() {
    if( debug ) console.log("> microdrawDBIP promise");

    $("#regionList").html("<br />Connecting to database...");
    return $.get(dbroot, {
        "action":"remote_address"
    }).success(function(data) {
        if( debug ) console.log("< microdrawDBIP resolve: success");
        $("#regionList").html("");
        myIP = data;
    }).error(function(jqXHR, textStatus, errorThrown) {
        console.log("< microdrawDBIP resolve: ERROR, " + textStatus + ", " + errorThrown);
        $("#regionList").html("<br />Error: Unable to connect to database.");
    });
}
*/

/**
 * @function save
 */
function save() {
    if( debug ) { console.log("> save"); }

    var i;
    var obj;
    var el;

    obj = {};
    obj.Regions = [];
    for( i = 0; i < ImageInfo[currentImage].Regions.length; i += 1 ) {
        el = {};
        el.path = ImageInfo[currentImage].Regions[i].path.exportJSON();
        el.name = ImageInfo[currentImage].Regions[i].name;
        obj.Regions.push(el);
    }
    localStorage.Microdraw = JSON.stringify(obj);

    if( debug ) { console.log("+ saved regions:", ImageInfo[currentImage].Regions.length); }
}

/**
 * @function load
 */
function load() {
    if( debug ) { console.log("> load"); }

    var i, obj, reg;
    if( localStorage.Microdraw ) {
        console.log("Loading data from localStorage");
        obj = JSON.parse(localStorage.Microdraw);
        for( i = 0; i < obj.Regions.length; i += 1 ) {
            var reg = {};
            var json;
            reg.name = obj.Regions[i].name;
            json = obj.Regions[i].path;
            reg.path = new paper.Path();
            reg.path.importJSON(json);
            newRegion({name:reg.name, path:reg.path});
        }
        paper.view.draw();
    }
}


/***5
    Initialisation
*/

/**
 * @function loadImage
 */
function loadImage(name) {
    if( debug ) { console.log("> loadImage(" + name + ")"); }
    // save previous image for some (later) cleanup
    prevImage = currentImage;

    // set current image to new image
    currentImage = name;

    viewer.open(ImageInfo[currentImage].source);
}

/**
 * @function loadNextImage
 */
function loadNextImage() {
    if( debug ) { console.log("> loadNextImage"); }
    var index = imageOrder.indexOf(currentImage);
    var nextIndex = (index + 1) % imageOrder.length;

    // update image slider
    updateSliderValue(nextIndex);

    loadImage(imageOrder[nextIndex]);
}

/**
 * @function loadPreviousImage
 */
function loadPreviousImage() {
    console.log("> loadPrevImage");
    var index = imageOrder.indexOf(currentImage);
    var previousIndex = ((index - 1 >= 0)? index - 1 : imageOrder.length - 1 );

    // update image slider
    updateSliderValue(previousIndex);

    loadImage(imageOrder[previousIndex]);
}


/**
 * @function resizeAnnotationOverlay
 */
function resizeAnnotationOverlay() {
    if( debug ) { console.log("> resizeAnnotationOverlay"); }

    var width = $("body").width();
    var height = $("body").height();
    $("canvas.overlay").width(width);
    $("canvas.overlay").height(height);
    paper.view.viewSize = [
width,
height
];
}

/**
 * @function initAnnotationOverlay
 */
function initAnnotationOverlay(data) {
    if( debug ) { console.log("> initAnnotationOverlay"); }

    // do not start loading a new annotation if a previous one is still being loaded
    if(annotationLoadingFlag == true) {
        return;
    }

    //console.log("new overlay size" + viewer.world.getItemAt(0).getContentSize());

    /*
       Activate the paper.js project corresponding to this slice. If it does not yet
       exist, create a new canvas and associate it to the new project. Hide the previous
       slice if it exists.
   */


    // change current slice index (for loading and saving)
    slice = currentImage;

    // hide previous slice
    if( prevImage && paper.projects[ImageInfo[prevImage].projectID] ) {
        paper.projects[ImageInfo[prevImage].projectID].activeLayer.visible = false;
        $(paper.projects[ImageInfo[prevImage].projectID].view.element).hide();
    }

    // if this is the first time a slice is accessed, create its canvas, its project,
    // and load its regions from the database
    if( ImageInfo[currentImage].projectID == undefined ) {

        // create canvas
        var canvas = $("<canvas class='overlay' id='" + currentImage + "'>");
        $("body").append(canvas);

        // create project
        paper.setup(canvas[0]);
        ImageInfo[currentImage].projectID = paper.project.index;

        // load regions from database
        if( config.useDatabase ) {
            microdrawDBLoad()
            .then(function() {
                $("#regionList").height($(window).height() - $("#regionList").offset().top);
                updateRegionList();
                paper.view.draw();
            });
        }

        if( debug ) { console.log('Set up new project, currentImage: ' + currentImage + ', ID: ' + ImageInfo[currentImage].projectID); }
    }

    // activate the current slice and make it visible
    paper.projects[ImageInfo[currentImage].projectID].activate();
    paper.project.activeLayer.visible = true;
    $(paper.project.view.element).show();

    // resize the view to the correct size
    var width = $("body").width();
    var height = $("body").height();
    paper.view.viewSize = [
width,
height
];
    paper.settings.handleSize = 10;
    updateRegionList();
    paper.view.draw();

    /**
     * @todo Commenting this line out solves the image size issues set size of the current overlay to match the size of the current image
     */

       magicV = viewer.world.getItemAt(0).getContentSize().x / 100;

    transform();
}

/**
 * @function transform
 */
function transform() {
    //if( debug ) console.log("> transform");

    var z = viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom(true));
    var sw = viewer.source.width;
    var bounds = viewer.viewport.getBounds(true);
    var x = magicV * bounds.x;
    var y = magicV * bounds.y;
    var w = magicV * bounds.width;
    var h = magicV * bounds.height;
    paper.view.setCenter(x + (w/2), y + (h/2));
    paper.view.zoom = (sw * z) / magicV;
}

/**
 * @function deparam
 */
function deparam() {
    if( debug ) { console.log("> deparam"); }

    var search = location.search.substring(1);
    var result = search?JSON.parse('{"' + search.replace(/&/g, '","').replace(/=/g, '":"') + '"}',
                     function(key, value) { return key === ""?value:decodeURIComponent(value); }):{};
    if( debug ) { console.log("url parametres:", result); }

    return result;
}

/**
 * @function loginChanged
 */
function loginChanged() {
    if( debug ) { console.log("> loginChanged"); }

    // updateUser();

    // remove all annotations and paper projects from old user
    /*
     * @todo Maybe save to db??
     */

    paper.projects[ImageInfo[currentImage].projectID].activeLayer.visible = false;
    $(paper.projects[ImageInfo[currentImage].projectID].view.element).hide();
    for( var i = 0; i < imageOrder.length; i += 1 ) {

        ImageInfo[imageOrder[i]].Regions = [];
        if( ImageInfo[imageOrder[i]].projectID != undefined ) {
            paper.projects[ImageInfo[imageOrder[i]].projectID].clear();
            paper.projects[ImageInfo[imageOrder[i]].projectID].remove();
            ImageInfo[imageOrder[i]].projectID = undefined;
        }
        $("<canvas class='overlay' id='" + currentImage + "'>").remove();
    }

    //load new users data

    viewer.open(ImageInfo[currentImage].source);
}

/**
 * @function makeSVGInline
 */
function makeSVGInline() {
    if( debug ) { console.log("> makeSVGInline promise"); }

    var def = $.Deferred();
    $('img.button').each(function() {
        var $img = $(this);
        var imgID = $img.attr('id');
        var imgClass = $img.attr('class');
        var imgURL = $img.attr('src');

        $.get(imgURL, function(data) {
            // Get the SVG tag, ignore the rest
            var $svg = $(data).find('svg');

            // Add replaced image's ID to the new SVG
            if( typeof imgID !== 'undefined' ) {
                $svg = $svg.attr('id', imgID);
            }
            // Add replaced image's classes to the new SVG
            if( typeof imgClass !== 'undefined' ) {
                $svg = $svg.attr('class', imgClass + ' replaced-svg');
            }

            // Remove any invalid XML tags as per http://validator.w3.org
            $svg = $svg.removeAttr('xmlns:a');

            // Replace image with new SVG
            $img.replaceWith($svg);

            if( debug ) {
                console.log("< makeSVGInline resolve: success");
            }
            def.resolve();
        }, 'xml');
    });

    return def.promise();
}

/**
 * @function updateSliceName
 */
function updateSliceName() {
    $("#slice-name").val(currentImage);
    var slash_index = params.source.lastIndexOf("/") + 1;
    var filename = params.source.substr(slash_index);
    $("title").text("MicroDraw|" + filename + "|" + currentImage);
}

/**
 * @function initShortCutHandler
 */
function initShortCutHandler() {
    $(document).keydown(function(e) {
        var key = [];
        if( e.ctrlKey ) { key.push("^"); }
        if( e.altKey ) { key.push("alt"); }
        if( e.shiftKey ) { key.push("shift"); }
        if( e.metaKey ) { key.push("cmd"); }
        key.push(String.fromCharCode(e.keyCode));
        key = key.join(" ");
        if( shortCuts[key] ) {
            var callback = shortCuts[key];
            callback();
            e.preventDefault();
        }
    });
}

/**
 * @function shortCutHandler
 */
function shortCutHandler(key, callback) {
    var key = isMac?key.mac:key.pc;
    var arr = key.split(" ");
    for( var i = 0; i < arr.length; i += 1 ) {
        if( arr[i].charAt(0) === "#" ) {
            arr[i] = String.fromCharCode(parseInt(arr[i].substring(1), 10));
        } else
        if( arr[i].length === 1 ) {
            arr[i] = arr[i].toUpperCase();
        }
    }
    key = arr.join(" ");
    shortCuts[key] = callback;
}

/**
 * @function initSlider
 */
function initSlider(min_val, max_val, step, default_value) {

/*
    Initializes a slider to easily change between slices
*/
    if( debug ) { console.log("> initSlider promise"); }
    var slider = $("#slider");
    if( slider.length > 0 ) { // only if slider could be found
        slider.attr("min", min_val);
        slider.attr("max", max_val - 1);
        slider.attr("step", step);
        slider.val(default_value);

        slider.on("change", function() {
            sliderOnChange(this.value);
        });

        // Input event can only be used when not using database, otherwise the annotations will be loaded several times
        /**
         * @todo Fix the issue with the annotations for real
         */

        if (config.useDatabase === false) {
            slider.on("input", function () {
                sliderOnChange(this.value);
            });
        }
    }
}

/**
 * @function sliderOnChange
 */
function sliderOnChange(newImageIndex) {

/*
    Called when the slider value is changed to load a new slice
*/
    if( debug ) { console.log("> sliderOnChange promise"); }
    var imageNumber = imageOrder[newImageIndex];
    loadImage(imageNumber);
}

/**
 * @function updateSliderValue
 */
function updateSliderValue(newIndex) {

/*
    Used to update the slider value if the slice was changed by another control
*/
    if( debug ) {
        console.log("> updateSliderValue promise");
    }
    var slider = $("#slider");
    if( slider.length > 0 ) { // only if slider could be found
        slider.val(newIndex);
    }
}

/**
 * @function findSliceNumber
 */
function findSliceNumber(number_str) {

/*
    Searches for the given slice-number.
    If the number could be found its index will be returned. Otherwise -1
*/
    var number = parseInt(number_str, 10); // number = NaN if cast to int failed!
    var i;
    if( !isNaN(number) ) {
        for( i = 0; i < imageOrder.length; i += 1 ) {
                var sliceNumber = parseInt(imageOrder[i], 10);
                // Compare the int values because the string values might be different (e.g. "0001" != "1")
                if( number === sliceNumber ) {
                    return i;
                }
        }
    }

    return -1;
}

/**
 * @function sliceNameOnEnter
 */
function sliceNameOnEnter(event) {

/*
    Eventhandler to open a specific slice by the enter key
*/
    if( debug ) {
        console.log("> sliceNameOnEnter promise");
    }
    if( event.keyCode === 13 ) { // enter key
        var sliceNumber = $(this).val();
        var index = findSliceNumber(sliceNumber);
        if( index > -1 ) { // if slice number exists
            updateSliderValue(index);
            loadImage(imageOrder[index]);
        }
    }
    event.preventDefault(); // prevent the default action (scroll / move caret)
}

/**
 * @function loadConfiguration
 */
function loadConfiguration() {
    var def = $.Deferred();
    // load general microdraw configuration
    $.getJSON("js/configuration.json", function(data) {
        config = data;

        drawingTools = [
                        "select",
                        "draw",
                        "draw-polygon",
                        "simplify",
                        "addpoint",
                        "delpoint",
                        "addregion",
                        "delregion",
                        "splitregion",
                        "rotate",
                        "save",
                        "copy",
                        "paste",
                        "delete"
        ];
        if( config.drawingEnabled == false ) {
            // remove drawing tools from ui
            for( var i = 0; i < drawingTools.length; i += 1 ) {
                $("#" + drawingTools[i]).remove();
            }

        }
        for( var i = 0; i < config.removeTools.length; i += 1 ) {
            $("#" + config.removeTools[i]).remove();
        }
        if( config.useDatabase === false ) {
            $("#save").remove();
        }
        def.resolve();
    });

    return def.promise();
}

/**
 * @function initMicrodraw
 */
function initMicrodraw() {
    if( debug ) {
        console.log("> initMicrodraw promise");
    }

    var def = $.Deferred();

    // Subscribe to login changes
    //MyLoginWidget.subscribe(loginChanged);

    // Enable click on toolbar buttons
    $("img.button").click(toolSelection);

    // set annotation loading flag to false
    annotationLoadingFlag = false;

    // Initialize the control key handler and set shortcuts
    initShortCutHandler();
    shortCutHandler({pc:'^ z', mac:'cmd z'}, cmdUndo);
    shortCutHandler({pc:'^ y', mac:'cmd y'}, cmdRedo);
    if( config.drawingEnabled ) {
        shortCutHandler({pc:'^ x', mac:'cmd x'}, function () {
            console.log("cut!");
        });
        shortCutHandler({pc:'^ v', mac:'cmd v'}, cmdPaste);
        shortCutHandler({pc:'^ a', mac:'cmd a'}, function () {
            console.log("select all!");
        });
        shortCutHandler({pc:'^ c', mac:'cmd c'}, cmdCopy);
        shortCutHandler({pc:'#46', mac:'#8'}, cmdDeleteSelected); // delete key
    }
    shortCutHandler({pc:'#37', mac:'#37'}, loadPreviousImage); // left-arrow key
    shortCutHandler({pc:'#39', mac:'#39'}, loadNextImage); // right-arrow key

    // Configure currently selected tool
    selectedTool = "zoom";
    selectTool();

    // decide between json (local) and jsonp (cross-origin)
    var ext = params.source.split(".");
    ext = ext[ext.length - 1];
    if( ext == "jsonp" ) {
        if( debug ) {
            console.log("Reading cross-origin jsonp file");
        }
        $.ajax({
            type: 'GET',
            url: params.source + "?callback=?",
            jsonpCallback: 'f',
            dataType: 'jsonp',
            contentType: "application/json",
            success: function(obj) { initMicrodraw2(obj); def.resolve(); }
        });
    } else
    if( ext == "json" ) {
        if( debug ) {
            console.log("Reading local json file");
        }
        $.ajax({
            type: 'GET',
            url: params.source,
            dataType: "json",
            contentType: "application/json",
            success: function(obj) {
                initMicrodraw2(obj);
                def.resolve();
            }
        });
    }

    // Change current slice by typing in the slice number and pessing the enter key
    $("#slice-name").keyup(sliceNameOnEnter);

    // Show and hide menu
    if( config.hideToolbar ) {
        var mousePosition;
        var animating = false;
        $(document).mousemove(function (e) {
            if( animating ) {
                return;
            }
            mousePosition = e.clientX;

            if( mousePosition <= 100 ) {
                //SLIDE IN MENU
                animating = true;
                $('#menuBar').animate({
                    left: 0,
                    opacity: 1
                }, 200, function () {
                    animating = false;
                });
            } else if( mousePosition > 200 ) {
                animating = true;
                $('#menuBar').animate({
                    left: -100,
                    opacity: 0
                }, 500, function () {
                    animating = false;
                });
            }
        });
    }

    $(window).resize(function() {
        $("#regionList").height($(window).height() - $("#regionList").offset().top);
        resizeAnnotationOverlay();
    });

    appendRegionTagsFromOntology(Ontology);

    return def.promise();
}

/**
 * @function initMicrodraw2
 */
function initMicrodraw2(obj) {
    if( debug ) {
        console.log("json file:", obj);
    }

    // for loading the bigbrain
    if( obj.tileCodeY ) {
        obj.tileSources = eval(obj.tileCodeY);
    }

    // set up the ImageInfo array and imageOrder array
    console.log(obj);
    for( var i = 0; i < obj.tileSources.length; i += 1 ) {
        // name is either the index of the tileSource or a named specified in the json file
        var name = ((obj.names && obj.names[i]) ? String(obj.names[i]) : String(i));
        imageOrder.push(name);
        ImageInfo[name] = {"source": obj.tileSources[i], "Regions": [], "projectID": null};
        // if getTileUrl is specified, we might need to eval it to get the function
        if( obj.tileSources[i].getTileUrl && typeof obj.tileSources[i].getTileUrl === 'string' ) {
            eval("ImageInfo[name]['source'].getTileUrl = " + obj.tileSources[i].getTileUrl);
        }
    }

    // set default values for new regions (general configuration)
    if (config.defaultStrokeColor == undefined) {
        config.defaultStrokeColor = 'black';
    }
    if (config.defaultStrokeWidth == undefined) {
        config.defaultStrokeWidth = 1;
    }
    if (config.defaultFillAlpha == undefined) {
        config.defaultFillAlpha = 0.5;
    }
    // set default values for new regions (per-brain configuration)
    if (obj.configuration) {
        if (obj.configuration.defaultStrokeColor != undefined) {
            config.defaultStrokeColor = obj.configuration.defaultStrokeColor;
        }
        if (obj.configuration.defaultStrokeWidth != undefined) {
            config.defaultStrokeWidth = obj.configuration.defaultStrokeWidth;
        }
        if (obj.configuration.defaultFillAlpha != undefined) {
            config.defaultFillAlpha = obj.configuration.defaultFillAlpha;
        }
    }

    // init slider that can be used to change between slides
    initSlider(0, obj.tileSources.length, 1, Math.round(obj.tileSources.length / 2));
    currentImage = imageOrder[Math.floor(obj.tileSources.length / 2)];

    params.tileSources = obj.tileSources;
    viewer = OpenSeadragon({
        id: "openseadragon1",
        prefixUrl: "lib/openseadragon/images/",
        tileSources: [],
        showReferenceStrip: false,
        referenceStripSizeRatio: 0.2,
        showNavigator: true,
        sequenceMode: false,
        navigatorId:"myNavigator",
        zoomInButton:"zoom-in",
        zoomOutButton:"zoom-out",
        homeButton:"home",
        maxZoomPixelRatio:10,
        preserveViewport: true,
        crossOriginPolicy: 'Anonymous'
    });

    // open the currentImage
    viewer.open(ImageInfo[currentImage].source);

    // add the scalebar
    viewer.scalebar({
        type: OpenSeadragon.ScalebarType.MICROSCOPE,
        minWidth:'150px',
        pixelsPerMeter:obj.pixelsPerMeter,
        color:'black',
        fontColor:'black',
        backgroundColor:"rgba(255, 255, 255, 0.5)",
        barThickness:4,
        location: OpenSeadragon.ScalebarLocation.TOP_RIGHT,
        xOffset:5,
        yOffset:5
    });

    // add screenshot
    viewer.screenshot({
        showOptions: true, // Default is false
        keyboardShortcut: 'p', // Default is null
        showScreenshotControl: true // Default is true
    });

    // add handlers: update slice name, animation, page change, mouse actions
    viewer.addHandler('open', function () {
        initAnnotationOverlay();
        updateSliceName();
    });
    viewer.addHandler('animation', function (event) {
        transform();
    });
    viewer.addHandler("page", function (data) {
        console.log(data.page, params.tileSources[data.page]);
    });
    viewer.addViewerInputHook({hooks: [
        {tracker: 'viewer', handler: 'clickHandler', hookHandler: clickHandler},
        {tracker: 'viewer', handler: 'pressHandler', hookHandler: pressHandler},
        {tracker: 'viewer', handler: 'dragHandler', hookHandler: dragHandler},
        {tracker: 'viewer', handler: 'dragEndHandler', hookHandler: dragEndHandler}
    ]});

    if( debug ) {
        console.log("< initMicrodraw2 resolve: success");
    }
}

/**
 * @function toggleMenu
 */
function toggleMenu() {
    if( $('#menuBar').css('display') == 'none' ) {
        $('#menuBar').css('display', 'block');
        $('#menuButton').css('display', 'none');
    } else {
        $('#menuBar').css('display', 'none');
        $('#menuButton').css('display', 'block');
    }
}

$(function () {
    $.when(
        loadConfiguration()
    ).then(function () {
        if( config.useDatabase ) {
            $.when(
                // microdrawDBIP(),
                // MyLoginWidget.init()
            ).then(function () {
                params = deparam();
                slice = currentImage;
                source = params.source;
                // updateUser();
            })
.then(initMicrodraw);
        } else {
            params = deparam();
            initMicrodraw();
        }
    });
});


/*
    // Log microdraw
    //microdrawDBSave(JSON.stringify(myOrigin), "entered", null);

    // load SVG overlay from localStorage
    microdrawDBLoad();
    //load();
*/
//})();

// For emacs users - set up the tabbing appropriately.
// Local Variables:
// mode: Javascript
// indent-tabs-mode: t
// tab-width: 4
// End:
