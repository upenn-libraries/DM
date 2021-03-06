goog.provide('atb.viewer.CanvasViewer');

goog.require('atb.viewer.Viewer');

goog.require('atb.ui.InfoPane');

goog.require('sc.canvas.CanvasViewer');
goog.require('sc.canvas.FabricCanvasFactory');
goog.require('atb.viewer.TextEditor');


atb.viewer.CanvasViewer = function(clientApp) {
    atb.viewer.Viewer.call(this, clientApp);
    
    this.viewer = null;
};
goog.inherits(atb.viewer.CanvasViewer, atb.viewer.Viewer);

atb.viewer.CanvasViewer.prototype.render = function(div) {
    if (this.rootDiv != null) {
        return;
    }

    this._isEditable = true;

    atb.viewer.Viewer.prototype.render.call(this, div);
    jQuery(this.rootDiv).addClass('atb-CanvasViewer');
    
    this.documentIcon = this.domHelper.createElement('div');
	jQuery(this.documentIcon).addClass('atb-viewer-documentIcon ' +
                                       'atb-viewer-documentIcon-noScrollbars');
	goog.events.listen(this.documentIcon, 'click',
                       this.handleDocumentIconClick_, false, this);
    this.rootDiv.appendChild(this.documentIcon);
    
    this.viewer = new sc.canvas.CanvasViewer({
        databroker: this.databroker
    });
    
    this.setupEventListeners();
    
    this.viewer.render(this.rootDiv);
};

atb.viewer.CanvasViewer.prototype._addDocumentIconListeners = function() {
    goog.events.removeAll(this.documentIcon, 'mouseover');
    goog.events.removeAll(this.documentIcon, 'mouseout');

    var self = this;
    var createButtonGenerator = atb.widgets.MenuUtil.createDefaultDomGenerator;

    if (this.isEditable()) {
        var menuButtons = [
            new atb.widgets.MenuItem(
                "showLinkedAnnos",
                createButtonGenerator("atb-radialmenu-button icon-search"),
                function(actionEvent) {
                    self.showAnnos(self.getUri());
                    
                    self.hideHoverMenu();
                },
                'Show resources which are linked to this canvas'
            ),
            new atb.widgets.MenuItem(
                "newTextAnno",
                createButtonGenerator("atb-radialmenu-button icon-pencil"),
                function(actionEvent) {
                    self.createTextAnno(self.getUri());
                    
                    self.hideHoverMenu();
                },
                'Annotate this canvas'
            )
        ];
    }
    else {
        var menuButtons = [];
    }

    this.addHoverMenuListenersToElement(this.documentIcon, menuButtons, this.getUri.bind(this));
};

atb.viewer.CanvasViewer.prototype.handleDocumentIconClick_ = function(event) {
    
};

atb.viewer.CanvasViewer.prototype.getUri = function() {
    if (this.viewer.mainViewport.canvas) {
        return this.viewer.mainViewport.canvas.getUri();
    }
    else {
        return '';
    }
};

atb.viewer.CanvasViewer.prototype.getResourceId = atb.viewer.CanvasViewer.prototype.getUri;

atb.viewer.CanvasViewer.prototype.setupControlEventListeners = function() {
    var panZoomControl = this.viewer.mainViewport.getControl('PanZoomGesturesControl');
    if (panZoomControl) {
        panZoomControl.addEventListener(
            'activated', function(event) {
                this.enableHoverMenus();
            }, false, this);
        panZoomControl.addEventListener(
            'deactivated', function(event) {
                this.disableHoverMenus();
            }, false, this);
        panZoomControl.addEventListener(
            'panstart', function(event) {
                this.isPanning = true;

                if (this.hoverMenusEnabled) {
                    this.disableHoverMenus();
                    goog.events.listenOnce(panZoomControl, 'panstop', function(event) {
                        this.enableHoverMenus();
                    }, false, this);
                }
            }, false, this);
        panZoomControl.addEventListener(
            'panstop', function(event) {
                this.isPanning = false;
                this.viewer.mainViewport.setCursor(null);
            }, false, this);
    }

    var zoomSlider = this.viewer.mainViewport.getControl('ZoomSliderControl');
    if (zoomSlider) {
        zoomSlider.addEventListener('slidestart', function(event) {
            if (this.hoverMenusEnabled) {
                this.disableHoverMenus();
                goog.events.listenOnce(zoomSlider, 'slidestop', this.enableHoverMenus.bind(this));
            }
        }, false, this);

        jQuery(zoomSlider.sliderDiv).mouseenter(function(e) {
            if (this.hoverMenusEnabled) {
                this.disableHoverMenus();
                jQuery(zoomSlider.sliderDiv).one('mouseleave', this.enableHoverMenus.bind(this));
            }
        }.bind(this));
    }
};

atb.viewer.CanvasViewer.prototype.setupEventListeners = function() {
    var self = this;
    var viewport = this.viewer.mainViewport;
    var eventDispatcher = this.clientApp.getEventDispatcher();

    this._addDocumentIconListeners();
    
    viewport.addEventListener('mouseup', this.onResourceClick, false, this);
    viewport.addEventListener('mouseover', this.onFeatureHover, false, this);
    viewport.addEventListener('mouseout', this.onFeatureMouseout, false, this);
    viewport.addEventListener('canvasAdded', this.onCanvasAdded, false, this);

    this.setupControlEventListeners();

/* SGB    
*/
    goog.events.listen(eventDispatcher, 'resource deleted', function (e) {
                       if (e && e.target)
                       var id = e.target;
                       var uri = id;
                       
                       try {
                       viewport.canvas.removeObjectByUri(uri);
                       } catch (error) {}
                       }, false, this);
    
    goog.events.listen(eventDispatcher, atb.events.LinkingModeExited.EVENT_TYPE,
                       this.handleLinkingModeExited, false, this);
};

atb.viewer.CanvasViewer.prototype.isEditable = function() {
    return this._isEditable;
};

atb.viewer.CanvasViewer.prototype.makeEditable = function() {
    if (!this.isEditable()) {
        this.viewer.makeEditable();

        this.setupControlEventListeners();

        this._isEditable = true;

        this._addDocumentIconListeners();
    }
};

atb.viewer.CanvasViewer.prototype.makeUneditable = function() {
    if (this.isEditable()) {
        this.viewer.makeUneditable();

        this.setupControlEventListeners();
        this.enableHoverMenus();

        this._isEditable = false;

        this._addDocumentIconListeners();
    }
};

atb.viewer.CanvasViewer.prototype.onCanvasAdded = function(event) {
    this.setTitle(this.getCompleteTitle());
};

atb.viewer.CanvasViewer.prototype.getCompleteTitle = function() {
    var canvas = this.viewer.mainViewport.canvas;
    var canvasResource = this.databroker.getResource(canvas.getUri());
    var title = this.databroker.dataModel.getTitle(canvasResource) || 'Untitled canvas';

    var parentResourceUri = this.databroker.dataModel.findManifestsContainingCanvas(canvasResource.uri)[0];
    if (parentResourceUri) {
        var parentResource = this.databroker.getResource(parentResourceUri);
        var parentTitle = this.databroker.dataModel.getTitle(parentResource);

        if (title.indexOf(parentTitle) == -1) {
            title = parentTitle + ', ' + title;
        }
    }

    return title;
};

atb.viewer.CanvasViewer.prototype.onFeatureHover = function(event) {
    var feature = event.feature;
    var uri = event.uri;
    
    if (uri == null || feature.type == 'image') return;
    if (this.isPanning) return;
    
    this.viewer.mainViewport.setCursor('pointer');

    this.mouseOverUri = uri;
    
    var id = uri;
    var self = this;
    var specificResourceUri = this.databroker.dataModel.findSelectorSpecificResourceUri(uri) || uri;
    var createButtonGenerator = atb.widgets.MenuUtil.createDefaultDomGenerator;
    
    var afterTimer = function () {
        if (this.mouseOverUri && this.mouseOverUri == uri) {
            if (this.isEditable()) {
                var menuButtons = [
                    // new atb.widgets.MenuItem(
                    //     "getMarkerInfo",
                    //     createButtonGenerator("atb-radialmenu-button icon-info-sign"),
                    //     function(actionEvent) {
                    //         var pane = new atb.ui.InfoPane(self.clientApp, id, self.domHelper);
                    //         pane.show();
                            
                    //         self.hideHoverMenu();
                    //     },
                    //     'Get marker info'
                    // ),
                    new atb.widgets.MenuItem(
                        "deleteThisMarker",
                        createButtonGenerator("atb-radialmenu-button icon-remove"),
                        function(actionEvent) {
                            self.deleteFeature(uri);
                            
                            self.hideHoverMenu();
                        },
                        'Delete this marker'
                    ),
                    new atb.widgets.MenuItem(
                        "hideMarker",
                        createButtonGenerator("atb-radialmenu-button icon-eye-close"),
                        function(actionEvent) {
                            self.hideFeature(uri);
                            
                            self.hideHoverMenu();
                        },
                        'Temporarily hide this marker'
                    ),
                    // new atb.widgets.MenuItem(
                    //     "showLinkedAnnos",
                    //     createButtonGenerator("atb-radialmenu-button icon-search"),
                    //     function(actionEvent) {
                    //         self.showAnnos(specificResourceUri);
                            
                    //         self.hideHoverMenu();
                    //     },
                    //     'Show other resources which are linked to this marker'
                    // ),
                    new atb.widgets.MenuItem(
                        "linkAway",
                        createButtonGenerator("atb-radialmenu-button atb-radialmenu-button-create-link"),
                        function(actionEvent) {
                            self.clientApp.createAnnoLink(specificResourceUri);
                            self.highlightFeature(uri);

                            if (self.annoTitlesList) {
                                self.annoTitlesList.loadForResource(specificResourceUri);
                            }
                        },
                        'Link another resource to this marker'
                    ),
                    new atb.widgets.MenuItem(
                        "newTextAnno",
                        createButtonGenerator("atb-radialmenu-button icon-pencil"),
                        function(actionEvent) {
                            self.createTextAnno(specificResourceUri);

                            if (self.annoTitlesList) {
                                self.annoTitlesList.loadForResource(specificResourceUri);
                            }
                        },
                        'Annotate this marker'
                    )
                ];
            }
            else {
                var menuButtons = [
                    new atb.widgets.MenuItem(
                        "hideMarker",
                        createButtonGenerator("atb-radialmenu-button icon-eye-close"),
                        function(actionEvent) {
                            self.hideFeature(uri);
                            
                            self.hideHoverMenu();
                        },
                        'Temporarily hide this marker'
                    )
                ];
            }

            this.showHoverMenu(menuButtons, specificResourceUri);
        }
    }.bind(this);
    window.setTimeout(afterTimer, atb.viewer.Viewer.HOVER_SHOW_DELAY);
};

atb.viewer.CanvasViewer.prototype.onFeatureMouseout = function(event) {
    this.viewer.mainViewport.setCursor(null);

    this.mouseOverUri = null;
    this.maybeHideHoverMenu();
};

atb.viewer.CanvasViewer.prototype.onResourceClick = function(event) {
    var uri = event.uri;
    if (! uri) return;
    var feature = event.getFeature();
    var specificResourceUri = this.databroker.dataModel.findSelectorSpecificResourceUri(uri);

    console.log('resource click', event, uri, feature)
    
    if (!specificResourceUri) return;
    if (! feature) return;
    if (feature.type == 'image') return;
    
    var eventDispatcher = this.clientApp.getEventDispatcher();
    var event = new atb.events.ResourceClick(specificResourceUri, eventDispatcher, this);

    var createButtonGenerator = atb.widgets.MenuUtil.createDefaultDomGenerator;

    if (eventDispatcher.dispatchEvent(event)) {
        
    }
};

atb.viewer.CanvasViewer.prototype.loadResourceByUri = function(uri) {
    var resource = this.databroker.getResource(uri);

    if (resource.hasAnyType(sc.data.DataModel.VOCABULARY.canvasTypes)) {
        this.setCanvasByUri(resource.getUri());
    }
    else if (resource.hasAnyType('oa:SpecificResource')) {
        this.loadSpecificResource(resource);
    }
    else if (resource.hasAnyType('oa:SvgSelector')) {
        var specificResource = this.databroker.getResource(this.databroker.dataModel.findSelectorSpecificResourceUri(uri));
        this.loadSpecificResource(specificResource);
    }
};

atb.viewer.CanvasViewer.prototype.loadSpecificResource = function(specificResource) {
    specificResource = this.databroker.getResource(specificResource);

    var sourceUri = specificResource.getOneProperty('oa:hasSource');
    var deferredCanvas = this.setCanvasByUri(sourceUri);

    var zoomToFeature = function() {
        this.viewer.mainViewport.pauseRendering();
        this.viewer.marqueeViewport.pauseRendering();

        var canvas = this.viewer.mainViewport.canvas;
        var featureUri = specificResource.getOneProperty('oa:hasSelector')
        var feature = canvas.getFabricObjectByUri(featureUri);

        if (feature) {
            canvas.hideMarkers();
            canvas.showObject(feature);

            this.viewer.mainViewport.zoomToFeatureByUri(featureUri);
        }
        else {
            console.error('Specific Resource', specificResource.uri, 'not found on canvas', canvas.getUri());
        }

        this.viewer.mainViewport.resumeRendering();
        this.viewer.marqueeViewport.resumeRendering();
    }.bind(this);

    deferredCanvas.progress(zoomToFeature).always(zoomToFeature);
};

atb.viewer.CanvasViewer.prototype.setCanvasByUri =
function(uri, opt_onLoad, opt_scope, opt_sequenceUris, opt_sequenceIndex) {
    this.showLoadingSpinner();
    
    var self = this;
    
    var deferredCanvas = sc.canvas.FabricCanvasFactory.createDeferredCanvas(
        uri,
        this.databroker,
        opt_sequenceUris,
        opt_sequenceIndex,
        opt_onLoad ? atb.Util.scopeAsyncHandler(opt_onLoad, opt_scope) : null
    );
    
    deferredCanvas.done(function(canvas) {
        self.hideLoadingSpinner();
    }).fail(function(canvas) {
        self.hideLoadingSpinner();
        self.flashErrorIcon();
    });
    
    this.viewer.addDeferredCanvas(deferredCanvas);

    return deferredCanvas;
};

atb.viewer.CanvasViewer.prototype.setCanvasById =
function(id, opt_onLoad, opt_scope, opt_sequenceUris, opt_sequenceIndex) {
    var uri = id;
    
    this.setCanvasByUri(uri, opt_onLoad, opt_scope, opt_sequenceUris,
                        opt_sequenceIndex);
};

atb.viewer.CanvasViewer.prototype.resize = function(width, height) {
    atb.viewer.Viewer.prototype.resize.call(this, width, height);

    this.viewer.resize(width, height);

    return this;
};


atb.viewer.CanvasViewer.prototype.deleteFeature = function(uri) {
    var viewport = this.viewer.mainViewport;
    viewport.canvas.removeObjectByUri(uri);
    viewport.requestFrameRender();

    var specificResourceUri = this.databroker.dataModel.findSelectorSpecificResourceUri(uri);
    
    var selectorResource = this.databroker.getResource(uri);
    var specificResource = this.databroker.getResource(specificResourceUri);
    goog.structs.forEach(specificResource.getReferencingResources('oa:hasTarget'), function(anno) {
        anno.deleteProperty('oa:hasTarget', specificResource);
    }, this);
    selectorResource.delete();
    specificResource.delete();
    
    var event = new goog.events.Event('resource-deleted', uri);
    var eventDispatcher = this.clientApp.getEventDispatcher();
    eventDispatcher.dispatchEvent(event);
};

atb.viewer.CanvasViewer.prototype.hideFeature = function(uri) {
    var viewport = this.viewer.mainViewport;

    var obj = viewport.canvas.getFabricObjectByUri(uri);
    viewport.canvas.hideObject(obj);
    viewport.requestFrameRender();
};

atb.viewer.CanvasViewer.prototype.showAnnos = function (opt_uri) {
	var uri = opt_uri || this.viewer.mainViewport.canvas.uri;
    var id = uri;
    
    var otherContainer = this.getPanelManager().getAnotherPanel(this.getPanelContainer());
    
	var finder = new atb.viewer.Finder(this.clientApp, id);
    finder.setContextType(atb.viewer.Finder.ContextTypes.RESOURCE);
    
	otherContainer.setViewer(finder);
    finder.loadSummaries([id]);
};

atb.viewer.CanvasViewer.prototype.createTextAnno = function(uri) {
    var canvasUri = this.viewer.mainViewport.canvas.getUri();
    var canvasResource = this.databroker.getResource(canvasUri);
    var canvasTitle = this.databroker.dataModel.getTitle(canvasResource) || 'Untitled canvas';
    
    var databroker = this.databroker;
    var body = databroker.dataModel.createText('New annotation on ' + canvasTitle);

    var anno = databroker.dataModel.createAnno(body, uri);
    
    var textEditor = new atb.viewer.TextEditor(this.clientApp);
    textEditor.setPurpose('anno');
    this.openRelatedViewer(textEditor);
    textEditor.loadResourceByUri(body.uri);
};

atb.viewer.CanvasViewer.HIGHLIGHTED_FEATURE_STYLE = {
    'stroke': '#D90000',
    'fill': '#D90000'
};

atb.viewer.CanvasViewer.prototype.highlightFeature = function(uri) {
    var feature = this.viewer.mainViewport.canvas.getFabricObjectByUri(uri);
    
    this.lastHighlightedFeatureUri = uri;
    this.lastHighlightedFeatureStyle = {
        stroke: feature.get('stroke'),
        fill: feature.get('fill')
    };
    
    feature.set(atb.viewer.CanvasViewer.HIGHLIGHTED_FEATURE_STYLE);
    this.viewer.mainViewport.requestFrameRender();
};

atb.viewer.CanvasViewer.prototype.unhighlightFeature = function(uri) {
    var feature = this.viewer.mainViewport.canvas.getFabricObjectByUri(uri);
    
    if (this.lastHighlightedFeatureStyle) {
        feature.set(this.lastHighlightedFeatureStyle);
    }

    this.viewer.mainViewport.requestFrameRender();
};

atb.viewer.CanvasViewer.prototype.flashFeatureHighlight = function(uri) {
    //Something may be buggy here
    this.highlightFeature(uri);
    
    atb.Util.timeoutSequence(sc.canvas.Canvas.FADE_SPEED, [
        function() {
            this.unhighlightFeature(uri);
        },
        function() {
            this.highlightFeature(uri);
        },
        function() {
            this.unhighlightFeature(uri);
        }
    ], this);
};

atb.viewer.CanvasViewer.prototype.handleLinkingModeExited = function(event) {
    var anno = this.databroker.getResource(event.uri);
    
    if (this.lastHighlightedFeatureUri) {
        this.unhighlightFeature(this.lastHighlightedFeatureUri);
    }
    
    var targetsAndBodies = new goog.structs.Set(anno.getProperties('oa:hasTarget').concat(anno.getProperties('oa:hasBody')));
    
    goog.structs.forEach(targetsAndBodies, function (uri) {
        if (uri) {
            this.flashFeatureHighlight(uri);
        }
        else if (this.getUri() == uri) {
            this.flashDocumentIconHighlight();
        }
    }, this);
};
