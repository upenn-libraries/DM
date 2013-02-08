goog.provide('sc.canvas.FeatureControl');

goog.require('sc.canvas.Control');

/**
 * Base class for CanvasViewport controls which deal with svg features.
 *
 * @author tandres@drew.edu (Tim Andres)
 *
 * @constructor
 * @extends {sc.canvas.Control}
 *
 * @param {sc.canvas.CanvasViewport} viewport The viewport to control.
 * @param {sc.data.Databroker} databroker The databroker from which to request
 * new uris and post new shape data.
 */
sc.canvas.FeatureControl = function(viewport, databroker) {
    sc.canvas.Control.call(this, viewport);
    
    /** @type {sc.data.Databroker} */
    this.databroker = databroker;
    
    /**
     * The current feature being drawn.
     * @type {(Raphael.Element|null)}
     */
    this.feature = null;
    
    /**
     * The uri for the feature being drawn
     * @type {string}
     */
    this.uri = '';
    
    this.shouldSaveChanges = true;
};
goog.inherits(sc.canvas.FeatureControl, sc.canvas.Control);

/**
 * This method should be called when the shape of a feature is updated.
 */
sc.canvas.FeatureControl.prototype.updateFeature = function() {
    var event = new goog.events.Event(sc.canvas.DrawFeatureControl.
                                      EVENT_TYPES.updateFeature, this.uri);
    event.feature = this.feature;
    this.dispatchEvent(event);
};

/**
 * If a feature is currently being drawn, it will be returned; otherwise, null
 * will be returned.
 * @return {(Raphael.Element|null)} The in progress drawing element or null if
 * drawing is not in progress.
 */
sc.canvas.FeatureControl.prototype.getInProgressFeature = function() {
    return this.feature;
};

/**
 * Converts page coordinates (such as those from a mouse event) into coordinates
 * on the canvas. (Useful with jQuery events, which calculate pageX and pageY
 * using client coordinates and window scroll values).
 *
 * @see sc.canvas.CanvasViewport.prototype.pageToCanvasCoord
 *
 * @param {(number|Object)} x The page x coordinate or an object with x and y
 * properties.
 * @param {?number} y The page y coordinate.
 * @return {Object} An object with x and y properties.
 */
sc.canvas.FeatureControl.prototype.pageToCanvasCoord = function(x, y) {
    return this.viewport.pageToCanvasCoord(x, y);
};

/**
 * Converts client coordinates (such as those from a mouse event) into
 * coordinates on the canvas.
 *
 * @see sc.canvas.CanvasViewport.prototype.canvasToPageCoord
 *
 * @param {(number|Object)} x The client x coordinate or an object with x and y
 * properties.
 * @param {?number} y The client y coordinate.
 * @return {Object} An object with x and y properties.
 */
sc.canvas.FeatureControl.prototype.clientToCanvasCoord = function(x, y) {
    return this.viewport.clientToCanvasCoord(x, y);
};

/**
 * Takes a Raphael feature and converts it to a string representation of an svg
 * feature
 *
 * @return {string} The svg representation.
 */
sc.canvas.FeatureControl.prototype.exportFeatureToSvg = function() {
    return sc.util.svg.raphaelElementToSVG(this.feature);
};

/**
 * Sends the finished drawn feature data to the databroker as new triples
 */
sc.canvas.FeatureControl.prototype.sendFeatureToDatabroker = function() {
    if (! this.shouldSaveChanges) {
        return;
    }
    
    this.hardcodeFeatureTransformations();
    
    var contentUri = this.feature.data('uri') || this.databroker.createUuid();
    var constrainedTargetUri = this.databroker.createUuid();
    var canvasUri = this.viewport.canvas.getUri();
    
    var svgString = this.exportFeatureToSvg();
    svgString = sc.util.Namespaces.escapeForXml(svgString);
    
    var content = this.databroker.createResource(
        contentUri,
        'cnt:ContentAsText'
    );
    content.addProperty('cnt:characterEncoding', '"UTF-8"');
    content.addProperty('cnt:chars', '"' + svgString + '"');
    
    var constrainedTarget = this.databroker.createResource(
        constrainedTargetUri,
        'oac:ConstrainedTarget'
    );
    constrainedTarget.addProperty('oac:constrains',
                                  '<' + canvasUri + '>');
    constrainedTarget.addProperty('oac:constrainedBy',
                                  '<' + contentUri + '>');
};

/**
 * Returns the top left coordinates of the bounding box for a feature
 *
 * @return {Object} The x and y coordinates of the feature's bounding box.
 */
sc.canvas.FeatureControl.prototype.getFeatureCoordinates = function() {
    var feature = this.feature;
    
    var type = feature.type;
    
    if (type == 'path') {
        var bbox = feature.getBBox();
        
        return {
            'x': bbox.x,
            'y': bbox.y
        };
    }
    else if (type == 'circle' || type == 'ellipse') {
        return {
            'x': feature.attr('cx'),
            'y': feature.attr('cy')
        };
    }
    else if (type == 'rect' || type == 'image') {
        return {
            'x': feature.attr('x'),
            'y': feature.attr('y')
        };
    }
};

/**
 * Effectively sets the x an y coordinates of the feature's bounding box using
 * transforms.
 *
 * @param {number} x The new x coordinate.
 * @param {number} y The new Y coordinate.
 */
sc.canvas.FeatureControl.prototype.setFeatureCoordinates = function(x, y) {
    var feature = this.feature;
    
    var type = feature.type;
    
    if (type == 'path') {
        var bbox = feature.getBBox();
        
        var deltaX = x - bbox.x;
        var deltaY = y - bbox.y;
        
        feature.transform('...T' + deltaX + ',' + deltaY);
    }
    else if (type == 'circle' || type == 'ellipse') {
        feature.attr('cx', x);
        feature.attr('cy', y);
    }
    else if (type == 'rect' || type == 'image') {
        feature.attr('x', x);
        feature.attr('y', y);
    }
};

/**
 * If the feature is a path, any transformations on the path will be converted
 * into new path commands, and the old transformations will be removed.
 */
sc.canvas.FeatureControl.prototype.hardcodeFeatureTransformations =
function() {
    var feature = this.feature;
    
    if (feature.type == 'path') {
        var transformedPath = Raphael.transformPath(feature.attr('path'),
                                                    feature.transform());
        
        feature.attr('path', transformedPath);
        feature.transform('');
    }
};

/**
 * Sets whether the control should save its changes to the databroker.
 *
 * @param {boolean} b True to save changes, false to not.
 */
sc.canvas.FeatureControl.prototype.setShouldSaveChanges = function(b) {
    this.shouldSaveChanges = b;
};

/**
 * Toggles whether the control saves its changes to the databroker.
 *
 * @return {boolean} Whether the control will now save changes.
 */
sc.canvas.FeatureControl.prototype.toggleShouldSaveChanges = function() {
    this.setShouldSaveChanges(!this.shouldSaveChanges);
    
    return this.shouldSaveChanges;
};