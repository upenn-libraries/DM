goog.provide('sc.RepoBrowser');

goog.require('goog.events.Event');
goog.require('goog.events.EventTarget');

goog.require('jquery.jQuery');
goog.require('jquery.popout');
goog.require('jquery.rdfquery');
goog.require('sc.Array');
goog.require('sc.BreadCrumbs');
goog.require('sc.RepoBrowserFolio');
goog.require('sc.RepoBrowserItem');
goog.require('sc.RepoBrowserManuscript');
goog.require('sc.data.Databroker');

/**
 * @author tandres@drew.edu (Tim Andres)
 *
 * Shared Canvas Repository Browser
 * Reads rdf files from manuscript repositories and displays them through drill-down menus and
 * expanding thumbnails, allowing for customization of the display format and actions
 *
 * @param options {?Object}
 *
 * @extends {goog.events.EventTarget}
 */
sc.RepoBrowser = function(options) {
    goog.events.EventTarget.call(this);

    if (! options) {
        options = {};
    }

    this.options = jQuery.extend(true, {
        databroker: new sc.data.Databroker(),
        repositoryUrlsByName: {
            'Stanford DMS': 'http://dms-data.stanford.edu/Repository.xml'
        },
        slideAnimationSpeed: 300,
        doc: window.document,
        imageSourceGenerator: function(url, opt_width, opt_height) {
            return this.databroker.getImageSrc(url, opt_width, opt_height);
        },
        errorHandler: jQuery.proxy(this.flashErrorIcon, this),
        showLoadingIndicator: jQuery.proxy(this.showLoadingSpinner, this),
        hideLoadingIndicator: jQuery.proxy(this.hideLoadingSpinner, this),
        showAddButton: true
    }, options);

    this.databroker = this.options.databroker;

    for (repositoryName in this.options.repositoryUrlsByName) {
        var url = this.options.repositoryUrlsByName[repositoryName];

        this.databroker.fetchRdf(url);
    }

    this.currentRepository = '';
};
goog.inherits(sc.RepoBrowser, goog.events.EventTarget);

/**
 * Shows the loading indicator specified in options, or the default loading indicator
 */
sc.RepoBrowser.prototype.showLoadingIndicator = function() {
    this.options.showLoadingIndicator();
};

/**
 * Hides the loading indicator specified in options, or the default loading indicator
 */
sc.RepoBrowser.prototype.hideLoadingIndicator = function() {
    this.options.hideLoadingIndicator();
};

/**
 * If an element is given, the RepoBrowser will be appended to it; otherwise, a div element containing
 * the RepoBrowser will be returned
 *
 * @param opt_div {?Element}
 * @return {Element}
 */
sc.RepoBrowser.prototype.render = function(opt_div) {
    var doc = this.options.doc;

    this.baseDiv = doc.createElement('div');
    jQuery(this.baseDiv).addClass('sc-RepoBrowser');

    this.spinner = doc.createElement('div');
    jQuery(this.spinner).addClass('sc-RepoBrowser-loadingSpinner');
    jQuery(this.spinner).hide();
    this.baseDiv.appendChild(this.spinner);

    this.errorIcon = doc.createElement('div');
    jQuery(this.errorIcon).addClass('sc-RepoBrowser-errorIcon');
    jQuery(this.errorIcon).hide();
    this.baseDiv.appendChild(this.errorIcon);


    this.messageDiv = doc.createElement('div');
    jQuery(this.messageDiv).addClass('sc-RepoBrowser-message');
    jQuery(this.messageDiv).hide();
    this.baseDiv.appendChild(this.messageDiv);

    this.breadCrumbs = new sc.BreadCrumbs(doc);
    this.breadCrumbs.render(this.baseDiv);

    this.innerDiv = doc.createElement('div');
    jQuery(this.innerDiv).addClass('sc-RepoBrowser-inner');
    jQuery(this.baseDiv).append(this.innerDiv);

    this.sectionDivs = {
        repositories: doc.createElement('div'),
        collections: doc.createElement('div'),
        manuscripts: doc.createElement('div')
    };
    for (var name in this.sectionDivs) {
        if (this.sectionDivs.hasOwnProperty(name)) {
            var sectionDiv = this.sectionDivs[name];

            jQuery(sectionDiv).addClass('sc-RepoBrowser-section');
        }
    }
    jQuery(this.sectionDivs.repositories).addClass('sc-RepoBrowser-repositories');
    jQuery(this.sectionDivs.collections).addClass('sc-RepoBrowser-collections');
    jQuery(this.sectionDivs.manuscripts).addClass('sc-RepoBrowser-manuscripts');

    jQuery(this.innerDiv).append(
        this.sectionDivs.repositories,
        this.sectionDivs.collections,
        this.sectionDivs.manuscripts
    );

    this.loadAllRepositories();

    if (opt_div) {
        jQuery(opt_div).append(this.baseDiv);
    }

    return this.baseDiv;
};

/**
 * Shows a spinning loading indicator
 */
sc.RepoBrowser.prototype.showLoadingSpinner = function() {
    var div = this.baseDiv;

    var top = jQuery(div).height() / 2 - 16;
    var left = jQuery(div).width() / 2 - 16;

    if (top < 0) top = 0;
    if (left < 0) left = 0;

    jQuery(this.spinner).css({'top': top, 'left': left});

    jQuery(this.spinner).fadeIn(200);
};

/**
 * Hides the spinning loading indicator
 */
sc.RepoBrowser.prototype.hideLoadingSpinner = function() {
    jQuery(this.spinner).fadeOut(200);
};

/**
 * Smoothly displays a network error icon for approximately one second
 */
sc.RepoBrowser.prototype.flashErrorIcon = function() {
    this.hideLoadingSpinner();

    var div = this.baseDiv;

    var top = jQuery(div).height() / 2 - 18;
    var left = jQuery(div).width() / 2 - 18;

    if (top < 0) top = 0;
    if (left < 0) left = 0;

    jQuery(this.errorIcon).css({'top': top, 'left': left});

    var self = this;
    jQuery(this.errorIcon).fadeIn(200, function() {
        window.setTimeout(function() {
            jQuery(self.errorIcon).fadeOut(1500);
        }, 1000);
    });
};

/**
 * Shows a textual message which floats centered over the browser
 *
 * @param text {string}
 */
sc.RepoBrowser.prototype.showMessage = function(text) {
    jQuery(this.messageDiv).text(text);

    // Calculate the height of the div without actually showing it
    jQuery(this.messageDiv).css({'visibility': 'hidden', 'display': 'block'});
    var textHeight = jQuery(this.messageDiv).height();
    jQuery(this.messageDiv).css({'display': 'none', 'visibility': 'visible'});

    var div = this.baseDiv;

    var top = (jQuery(div).height()) / 2 - (textHeight / 2);
    var left = 0;
    var width = jQuery(div).width();
    jQuery(this.messageDiv).css({'top': top, 'left': left, 'width': width});

    jQuery(this.messageDiv).fadeIn(200);
};

/**
 * Hides the textual message which floats over the browser
 */
sc.RepoBrowser.prototype.hideMessage = function() {
    jQuery(this.messageDiv).fadeOut(200);
};

/**
 * @private
 * @param {number} index
 * @param {!Function} opt_after
 */
sc.RepoBrowser.prototype.slideToIndex_ = function(index, opt_after) {
    jQuery(this.innerDiv).animate({
        'margin-left': String(-100 * index) + '%'
    }, this.animationSpeed, opt_after);

    this.hideMessage();
};

/**
 * Slides the drill-down view to the All Repositories section
 * @param opt_after {function} code to perform after the slide is completed.
 */
sc.RepoBrowser.prototype.slideToRepositories = function(opt_after) {
    var self = this;

    return this.slideToIndex_(0, function() {
        if (jQuery.isFunction(opt_after)) {
            opt_after();
        }
    });
};

/**
 * Slides the drill-down view to the Collections section of a repository
 * @param opt_after {function} code to perform after the slide is completed.
 */
sc.RepoBrowser.prototype.slideToCollections = function(opt_after) {
    var self = this;

    return this.slideToIndex_(1, function() {
        if (jQuery.isFunction(opt_after)) {
            opt_after();
        }
    });
};

/**
 * Slides the drill-down view to the Manuscripts section of a collection
 * @param opt_after {function} code to perform after the slide is completed.
 */
sc.RepoBrowser.prototype.slideToManuscripts = function(opt_after) {
    var self = this;

    return this.slideToIndex_(2, function() {
        if (jQuery.isFunction(opt_after)) {
            opt_after();
        }
    });
};

/**
 * Displays working links to all repositories specified in this.options.repositoryUrlsByName
 */
sc.RepoBrowser.prototype.loadAllRepositories = function() {
    var self = this;
    var repositoryUrls = this.options.repositoryUrlsByName;
    var repositoriesDiv = this.sectionDivs.repositories;

    jQuery(repositoriesDiv).empty();

    this.slideToRepositories();

    this.breadCrumbs.push('Repositories', function() {
        self.loadAllRepositories();
    });

    for (var name in repositoryUrls) {
        if (repositoryUrls.hasOwnProperty(name)) {
            var url = String(repositoryUrls[name]);

            var item = new sc.RepoBrowserItem(self);
            item.setTitle(name);
            item.render(repositoriesDiv);
            item.bind('click', {url: url, name: name}, function(event) {
                self.loadRepositoryByUrl(event.data.url);
            });
        }
    }
};

sc.RepoBrowser.prototype.pushTitleToBreadCrumbs = function(uri, clickHandler) {
    var self = this;

    var title = sc.RepoBrowser.parseTitleFromPath(uri);
    this.breadCrumbs.push(title, clickHandler);
};

sc.RepoBrowser.prototype.createItemEvent = function(item, eventType, originalEvent, manifestUri) {
    var itemEvent = new goog.events.Event(eventType, this);
    itemEvent.originalEvent = originalEvent;
    itemEvent.uri = item.getUri();
    itemEvent.item = item;
    itemEvent.manifestUri = manifestUri;

    itemEvent.resource = this.databroker.getResource(item.getUri());

    return itemEvent;
};

sc.RepoBrowser.prototype.addManifestItem = function(uri, clickHandler, div) {
    var self = this;

    var collection = self.databroker.getDeferredResource(uri);

    var item = new sc.RepoBrowserItem(self);
    item.setTitle(uri, true);
    item.setUri(uri);
    item.render(div);

    var handler = function(event, item) {
        if (self.dispatchEvent(self.createItemEvent(item, 'click', event, uri))) {
            clickHandler(uri);
        }
    };
    item.unbind('click');
    item.bind('click', handler);

    item.bind('mouseover', function(event, item) {
        self.dispatchEvent(self.createItemEvent(item, 'mouseover', event, uri));
    });
    item.bind('mouseout', function(event, item) {
        self.dispatchEvent(self.createItemEvent(item, 'mouseout', event, uri));
    });

    var withResource = function(resource) {
        if (resource.hasPredicate('dc:title')) {
            item.setTitle(resource.getOneProperty('dc:title'));
        }
    };
    collection.progress(withResource).done(withResource);

    collection.fail(function(resource) {
        item.indicateNetworkError();
    });
};

sc.RepoBrowser.prototype.addManifestItems = function(manifestUri, clickHandler, div) {
    var self = this;

    this.showLoadingIndicator();

    this.databroker.getDeferredResource(manifestUri).done(function(resource) {
        var aggregatedUris = self.databroker.getAggregationContentsUris(manifestUri);

        var fragment = self.options.doc.createDocumentFragment();

        for (var i = 0, len = aggregatedUris.length; i < len; i++) {
            var uri = aggregatedUris[i];

            self.addManifestItem(uri, clickHandler, fragment);
        }

        div.appendChild(fragment);

        self.hideLoadingIndicator();
    });
};

/**
 * Loads all collections in a given repository given the url of the repository rdf file
 * @param url {string}
 */
sc.RepoBrowser.prototype.loadRepositoryByUrl = function(url) {
    var self = this;
    var collectionsDiv = this.sectionDivs.collections;

    this.slideToCollections();

    this.repositoryUrl = url;
    this.currentRepository = sc.RepoBrowser.parseRepoTitleFromURI(url);

    jQuery(collectionsDiv).empty();

    this.showLoadingIndicator();

    this.databroker.getDeferredResource(url).done(function(resource) {
        console.log(url);
        var uri = self.databroker.getResourcesDescribedByUrl(url)[0];
        if (uri !== undefined) {
            var uri = sc.util.Namespaces.stripAngleBrackets(uri);

            self.pushTitleToBreadCrumbs(uri, function() {
                self.loadRepositoryByUrl(url);
            });

            self.addManifestItems(uri, 
                                  jQuery.proxy(self.loadCollectionByUri, self), 
                                  collectionsDiv);
        }
    });
};

/**
 * Loads all manuscripts in a given collection given the uri of the collection
 * @param uri {string}
 */
sc.RepoBrowser.prototype.loadCollectionByUri = function(uri) {
    var self = this;

    var manuscriptsDiv = this.sectionDivs.manuscripts;

    this.slideToManuscripts();

    this.collectionUri = uri;

    jQuery(manuscriptsDiv).empty();

    this.pushTitleToBreadCrumbs(uri, function() {
        self.loadCollectionByUri(uri);
    });

    var manifest = this.databroker.getDeferredResource(uri);
    manifest.done(function(resource) {
        self.generateManuscriptItems(uri);
    });
};

sc.RepoBrowser.prototype.generateManuscriptItems = function(manifestUri) {
    var self = this;
    var manuscriptsDiv = this.sectionDivs.manuscripts;

    var aggregatedUris = self.databroker.getAggregationContentsUris(manifestUri);

    var fragment = this.options.doc.createDocumentFragment();

    for (var i = 0, len = aggregatedUris.length; i < len; i++) {
        var uri = aggregatedUris[i];

        var item = this.generateManuscriptItem(uri);
        item.render(fragment);
    }

    manuscriptsDiv.appendChild(fragment);
};

sc.RepoBrowser.prototype.generateManuscriptItem = function(uri) {
    var item = new sc.RepoBrowserManuscript(this);
    item.setTitle(uri, true);
    item.setUri(uri);
    item.showFoliaMessage('Loading folia...');

    if (this.options.showAddButton) {
        item.showAddButton(jQuery.proxy(function(event, item) {
            this.dispatchEvent(this.createItemEvent(item, 'add_request', event, uri));
        }, this));
    }

    var deferredManuscript = this.databroker.getDeferredResource(uri);
    var withManuscript = jQuery.proxy(function(manuscript) {
        if (manuscript.hasPredicate('dc:title')) {
            item.setTitle(manuscript.getOneProperty('dc:title'));
        }

        var sequenceUri = this.databroker.getManuscriptSequenceUris(uri)[0];
        var imageAnnoUri = this.databroker.getManuscriptImageAnnoUris(uri)[0];

        if (sequenceUri && imageAnnoUri && item.getNumFolia() == 0) {
            window.setTimeout(jQuery.proxy(function() {
                this.generateManuscriptFolia(uri, item);
            }, this), 1);
        }
    }, this);
    deferredManuscript.progress(withManuscript).done(withManuscript);

    deferredManuscript.fail(jQuery.proxy(function(manuscript) {
        item.indicateNetworkError();
        item.showFoliaMessage('There was a network error when attempting to load this manuscript.');
    }, this));

    return item;
};

sc.RepoBrowser.prototype.generateManuscriptFolia = function(manuscriptUri, manuscriptItem) {
    var sequenceUri = this.databroker.getManuscriptSequenceUris(manuscriptUri)[0];
    var imageAnnoUri = this.databroker.getManuscriptImageAnnoUris(manuscriptUri)[0];

    var deferredSequence = this.databroker.getDeferredResource(sequenceUri);
    var deferredImageAnno = this.databroker.getDeferredResource(imageAnnoUri);

    deferredSequence.done(jQuery.proxy(function(sequence) {
        if (manuscriptItem.getNumFolia() > 0) {
            return;
        }

        var urisInOrder = this.databroker.getListUrisInOrder(sequenceUri);
        var thumbs = [];
        var thumbsByUri = {};

        manuscriptItem.hideFoliaMessage();

        for (var i = 0, len = urisInOrder.length; i < len; i++) {
            var canvasUri = urisInOrder[i];

            var thumb = new sc.RepoBrowserFolio(this);
            thumb.setType('dms:Canvas');
            thumb.setUri(canvasUri);
            thumb.setUrisInOrder(urisInOrder);
            thumb.setCurrentIndex(i);

            var canvasResource = this.databroker.getResource(canvasUri);

            var title = canvasResource.getOneProperty('dc:title');
            if (title) {
                thumb.setTitle(title);
            }

            thumbs.push(thumb);
            thumbsByUri[canvasUri] = thumb;
        }

        manuscriptItem.addFolia(thumbs);

        for (var i = 0, len = urisInOrder.length; i < len; i++) {
            var thumb = thumbs[i];
            var canvasUri = thumb.getUri();

            thumb.bind('click', jQuery.proxy(function(event, thumb) {
                var itemEvent = this.createItemEvent(thumb, 'click', event, manuscriptUri);
                itemEvent.urisInOrder = thumb.getUrisInOrder();
                itemEvent.currentIndex = thumb.getCurrentIndex();
                this.dispatchEvent(itemEvent);
            }, this));

            thumb.bind('mouseover', jQuery.proxy(function(event, thumb) {
                var itemEvent = this.createItemEvent(thumb, 'mouseover', event, manuscriptUri);
                itemEvent.urisInOrder = thumb.getUrisInOrder();
                itemEvent.currentIndex = thumb.getCurrentIndex();
                this.dispatchEvent(itemEvent);
            }, this));
            thumb.bind('mouseout', jQuery.proxy(function(event, thumb) {
                var itemEvent = this.createItemEvent(thumb, 'mouseout', event, manuscriptUri);
                itemEvent.urisInOrder = thumb.getUrisInOrder();
                itemEvent.currentIndex = thumb.getCurrentIndex();
                this.dispatchEvent(itemEvent);
            }, this));

            if (this.options.showAddButton) {
                thumb.showAddButton(jQuery.proxy(function(event, thumb) {
                    var itemEvent = this.createItemEvent(thumb, 'add_request', event, manuscriptUri);
                    itemEvent.urisInOrder = thumb.getUrisInOrder();
                    itemEvent.currentIndex = thumb.getCurrentIndex();
                    this.dispatchEvent(itemEvent);
                }, this));
            }
        }

        if (thumbs.length == 0) {
            manuscriptItem.showFoliaMessage('Badly formed data - unable to determine page order');
        }

        deferredImageAnno.done(jQuery.proxy(function(imageAnnos) {
            for (var uri in thumbsByUri) {
                var thumb = thumbsByUri[uri];
                var canvasResource = this.databroker.getResource(uri);

                var title = canvasResource.getOneProperty('dc:title');
                if (title) {
                    thumb.setTitle(title);
                }
            }

            if (urisInOrder.length > 0) {
                var firstThumbSrc = this.databroker.getCanvasImageUris(urisInOrder[0])[0];
                if (firstThumbSrc) {
                    var image = this.databroker.getResource(firstThumbSrc);

                    var size = new goog.math.Size(
                        image.getOneProperty('exif:width'),
                        image.getOneProperty('exif:height')
                    ).scaleToFit(sc.RepoBrowserManuscript.THUMB_SIZE);

                    manuscriptItem.setThumb(
                        this.options.imageSourceGenerator(firstThumbSrc, size.width, size.height),
                        size.width,
                        size.height
                    );
                }
            }
        }, this));
    }, this));

    deferredSequence.fail(jQuery.proxy(function() {
        manuscriptItem.showFoliaMessage('Unable to load folia information');
    }, this));
};

/**
 * Parses the canvas number from its uri. Returns -1 if
 * the number cannot be parsed.
 *
 * @note initially used as a hack for sorting, which is now performed correctly
 * with sequence files
 *
 * @static
 * @param uri {string}
 * @param return number}.
 */
sc.RepoBrowser.parseCanvasNumberFromURI = function(uri) {
    var numberRegex = /-(\d+)$/;
    var match = numberRegex.exec(uri);

    if (match) {
        return Number(match[1]);
    } else {
        return -1;
    }
};

/**
 * Attempts to parse the name of a collection from its path
 */
sc.RepoBrowser.parseCollectionTitleFromPath = function(path) {
    var nameRegex = /\/(\w+)\/Collection/;
    var match = nameRegex.exec(path);

    if (match) {
        var title = match[1];
    } else {
        var title = '';
    }

    return title;
};

/**
 * Attempts to parse the name of a manuscript from its manifest path uri
 */
sc.RepoBrowser.parseManuscriptTitleFromPath = function(path) {
    var nameRegex = /\/(\w+)\/Manifest/;
    var match = nameRegex.exec(path);

    if (match) {
        var title = match[1];
    }
    else {
        var title = '';
    }

    return title;
};

/**
 * Parses the name of a repository from its uri by using the domain name
 */
sc.RepoBrowser.parseRepoTitleFromURI = function(uri) {
    var nameRegex = /\/\/([^\/]+)\//;
    var match = nameRegex.exec(uri);

    if (match) {
        var title = match[1];
    } else {
        var title = '';
    }

    return title;
};

/**
 * Attempts to parse the title of a resource from its path (or uri)
 */
sc.RepoBrowser.parseTitleFromPath = function(path) {
    var title = sc.RepoBrowser.parseCollectionTitleFromPath(path);
    if (title) return title;

    title = sc.RepoBrowser.parseManuscriptTitleFromPath(path);
    if (title) return title;

    title = sc.RepoBrowser.parseRepoTitleFromURI(path);
    if (title) return title;

    var index = path.lastIndexOf('/');
    if (index + 1 == path.length) {
        path = path.substring(0, path.length - 1);

        return path.substring(path.lastIndexOf('/'), path.length);
    }
    else {
        return path.substring(index, path.length);
    }
};