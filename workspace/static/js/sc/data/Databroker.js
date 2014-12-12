goog.provide('sc.data.Databroker');

goog.require('goog.Uri');
goog.require('goog.string');
goog.require('goog.object');
goog.require('goog.structs.Map');
goog.require('goog.structs.Set');
goog.require('sc.data.Resource');

goog.require('sc.data.Quad');
goog.require('sc.data.BNode');
goog.require('sc.data.QuadStore');
goog.require('sc.data.Graph');
goog.require('sc.data.DataModel');
goog.require('sc.data.SyncService');
goog.require('sc.data.RDFQueryParser');
goog.require('sc.data.N3Parser');
goog.require('sc.data.RDFQuerySerializer');
goog.require('sc.data.TurtleSerializer');

goog.require('sc.util.DefaultDict');
goog.require('sc.util.DeferredCollection');
goog.require('sc.data.NamespaceManager');
goog.require('sc.data.Term');
goog.require('sc.data.ProjectController');
goog.require('sc.data.SearchClient');


/**
 * @class
 *
 * Handles the storage, requesting, and querying of data
 *
 * @author tandres@drew.edu (Tim Andres)
 */
sc.data.Databroker = function(options) {
    this.options = {};
    goog.object.extend(this.options, sc.data.Databroker.DEFAULT_OPTIONS, options || {});

    this.corsEnabledDomains = new goog.structs.Set(this.options.corsEnabledDomains);

    this.namespaces = this.options.namespaces || new sc.data.NamespaceManager();
    this.quadStore = this.options.quadStore || new sc.data.QuadStore();
    this.syncService = this.options.syncService || new sc.data.SyncService();
    this.syncService.databroker = this;

    goog.events.listen(window, 'beforeunload', function(event) {
        if (this.syncService.hasUnsavedChanges()) {
            // Bob: This doesn't appear to be working because you can definitely leave the page without saving.

            message = 'Not all changes have been synchronized with the server yet. Please wait a few seconds before leaving the page.';

            this.sync();

            (event || window.event).returnValue = message;
            return message;
        }
    }, false, this);

    this._setupParsersAndSerializers();

    this.requestedUrls = new goog.structs.Set();
    this.receivedUrls = new goog.structs.Set();
    this.failedUrls = new goog.structs.Set();

    this.jqXhrs = new goog.structs.Set();
    this.jqXhrsByUrl = new goog.structs.Map();

    this.rdfByUrl = new goog.structs.Map();

    this._bNodeCounter = 0;
    
    this.newQuadStore = new sc.data.QuadStore();
    this.deletedQuadsStore = new sc.data.QuadStore();

    this.user = this.options.user;

    this.newResourceUris = new goog.structs.Set();
    this.deletedResourceUris = new goog.structs.Set();

    // This is how the sync happens!
    this.syncIntervalId = window.setInterval(this.sync.bind(this), sc.data.Databroker.SYNC_INTERVAL);

    this.hasSyncErrors = false;

    this.dataModel = new sc.data.DataModel(this);
    this.projectController = new sc.data.ProjectController(this);
    this.searchClient = new sc.data.SearchClient(this);

    console.warn('In the Databroker obj..');
};

sc.data.Databroker.SYNC_INTERVAL = 15 * 1000;

sc.data.Databroker.DEFAULT_OPTIONS = {
    proxiedUrlGenerator: function(url) {
        return url;
    },
    imageSourceGenerator: function(url, opt_width, opt_height) {
        if (url.indexOf('https://stacks-test.stanford.edu') != -1) {
            url = url.replace('https://stacks-test.stanford.edu', 'https://stacks.stanford.edu');
        }

        if (url.indexOf('stacks.stanford.edu') != -1) {
            url = url.replace('http://', 'https://');

            if (url.indexOf('/image/app/') == -1)
                url = url.replace('/image/', '/image/app/');
        }

        if (opt_width && opt_height) {
            if (window.devicePixelRatio) {
                opt_width *= window.devicePixelRatio;
                opt_height *= window.devicePixelRatio;
            }

            if (url.indexOf('/full/full/0/') == -1) {
                url += '?'
                if (opt_width)
                    url += 'w=' + String(Math.round(opt_width)) + '&';
                if (opt_height)
                    url += 'h=' + String(Math.round(opt_height)) + '&';
            }
            else {
                url = url.replace('/full/full/0/', '/full/!' + Math.round(opt_width) + ',' + Math.round(opt_height) + '/0/');
            }
        }

        return url;
    },
    corsEnabledDomains: [],
    user: null
};

// Note: ordering here matters for preferred formats
sc.data.Databroker.DEFAULT_PARSER_CLASSES = [sc.data.N3Parser, sc.data.RDFQueryParser];
sc.data.Databroker.DEFAULT_SERIALIZER_CLASSES = [sc.data.RDFQuerySerializer, sc.data.TurtleSerializer];

sc.data.Databroker.prototype._setupParsersAndSerializers = function() {
    this.parsers = [];
    this.parsersByType = new sc.util.DefaultDict(sc.util.DefaultDict.GENERATORS.list);
    this.parseableTypes = new goog.structs.Set();

    this.serializers = [];
    this.serializersByType = new sc.util.DefaultDict(sc.util.DefaultDict.GENERATORS.list);

    if (this.options.parsers == null) {
        goog.structs.forEach(sc.data.Databroker.DEFAULT_PARSER_CLASSES, function(cls) {
            var parser = new cls(this);
            this.registerParser(parser);
        }, this);
    }
    else {
        goog.structs.forEach(this.options.parsers, this.registerParser, this);
    }

    if (this.options.serializers == null) {
        goog.structs.forEach(sc.data.Databroker.DEFAULT_SERIALIZER_CLASSES, function(cls) {
            var serializer = new cls(this);
            this.registerSerializer(serializer);
        }, this);
    }
    else {
        goog.structs.forEach(this.options.serializers, this.registerSerializer, this);
    }
};


/**
 * Returns a proxied url without checking if proxying is necessary.
 * @private
 * @param  {string} url The url to proxy.
 * @return {string} The proxied url.
 */
sc.data.Databroker.prototype._proxyUrl = function(url) {
    return this.options.proxiedUrlGenerator(url);
};

/**
 * Checks to see if the url requires a proxy for ajax access, and
 * returns a proxied url if necessary, or the same url if not.
 * @param  {string} url The url to proxy.
 * @return {[type]} The proxied (or original) url.
 */
sc.data.Databroker.prototype.proxyUrl = function(url) {
    if (this.shouldProxy(url)) {
        return this._proxyUrl(url);
    }
    else {
        return url;
    }
};

/**
 * Determines whether a proxy is required to access the given url with
 * ajax. Returns true iff the host of the url does not match the window's
 * location, or the domain of the url was specified as sending the appropriate
 * CORS headers in the databroker's {corsEnabledDomains} option.
 * @param  {string} url The url to check.
 * @return {boolean} Whether proxying is required.
 */
sc.data.Databroker.prototype.shouldProxy = function(url) {
    var uri = new goog.Uri(url);

    if (this.corsEnabledDomains.contains(uri.getDomain())) {
        return false;
    }
    else {
        var hostname = window.location.hostname;
        var port = window.location.port;

        return !(uri.getDomain() == hostname && uri.getPort() == port);
    }
};

/**
 * @return {sc.data.NamespaceManager} The namespace utility object associated with the data store.
 */
sc.data.Databroker.prototype.getNamespaceManager = function() {
    return this.namespaces;
};

/**
 * @return {sc.data.QuadStore} The quad store which holds all rdf data.
 */
sc.data.Databroker.prototype.getQuadStore = function() {
    return this.quadStore;
};

/**
 * Fetches an rdf formatted file, and calls the handler with the jQuery.rdfquery object
 * @param {string} url
 * @param {?function(jQuery.rdfquery, Object, string)} handler
 * @param {?boolean} opt_forceReload false by default to use cached resources.
 */
sc.data.Databroker.prototype.fetchRdf = function(url, handler, opt_forceReload) {
    var self = this;

    if (! jQuery.isFunction(handler)) {
        handler = jQuery.noop;
    }

    this.requestedUrls.add(url);

    var proxiedUrl = this.proxyUrl(url);

    var deferred = jQuery.Deferred();

    var successHandler = function(data, textStatus, jqXhr) {
        self.receivedUrls.add(url);

        if (data) {
            self.processResponse(data, url, jqXhr, function() {
                handler.apply(this, arguments);
                deferred.resolveWith(this, arguments);
            });
        }
        else {
            // Received a successful response with no data, such as a 204
        }
    };

    var errorHandler = function(jqXhr, textStatus, errorThrown) {
        self.failedUrls.add(url);

        deferred.rejectWith(this, arguments);
    };

    if (this.jqXhrsByUrl.containsKey(url) && !opt_forceReload) {
        var jqXhr = this.jqXhrsByUrl.get(url);
        jqXhr.done(successHandler).fail(errorHandler);
    }
    else {
        var jqXhr = jQuery.ajax({
            type: 'GET',
            url: proxiedUrl,
            success: successHandler,
            error: errorHandler,
            headers: {
                'Accept': this.parseableTypes.getValues().join(', ')
            }
        });

        this.jqXhrs.add(jqXhr);
        this.jqXhrsByUrl.set(url, jqXhr);
    }

    return deferred;
};

sc.data.Databroker.prototype.getNextBNode = function() {
    var node = new sc.data.BNode(this._bNodeCounter);
    this._bNodeCounter ++;
    return node;
};

/**
 * Returns a quad with Blank Nodes guaranteed to be unique in the main quad store.
 * @param  {sc.data.Quad} quad             The quad to make unique
 * @param  {goog.structs.Map} bNodeMapping A reference to a mapping of old BNodes to new BNodes
 *                                         for the current batch of quads (usually one file)
 * @return {sc.data.Quad}                  A guaranteed BNode safe quad.
 */
sc.data.Databroker.prototype.getBNodeHandledQuad = function(quad, bNodeMapping) {
    var modifiedQuad = quad.clone();

    goog.structs.forEach(['subject', 'predicate', 'object', 'context'], function(prop) {
        if (sc.data.Term.isBNode(quad[prop])) {
            if (bNodeMapping.containsKey(quad[prop])) {
                modifiedQuad[prop] = bNodeMapping.get(quad[prop]);
            }
            else {
                var newBNode = this.getNextBNode();
                modifiedQuad[prop] = newBNode;
                bNodeMapping.set(quad[prop], newBNode);
            }
        }
    }, this);

    return modifiedQuad;
};

sc.data.Databroker.prototype.processResponse = function(data, url, jqXhr, handler) {
    var responseHeaders = jqXhr.getAllResponseHeaders();
    var type = sc.data.Parser.parseContentType(responseHeaders);

    window.setTimeout(function() {
        this.processRdfData(data, type, handler)
    }.bind(this), 1);
};

sc.data.Databroker.prototype.processRdfData = function(data, format, handler) {
    var bNodeMapping = new goog.structs.Map();

    this.parseRdf(data, format, function(quadBatch, done, error) {
        for (var i=0, len=quadBatch.length; i<len; i++) {
            var bNodeHandledQuad = this.getBNodeHandledQuad(quadBatch[i], bNodeMapping);
            if (!this.deletedQuadsStore.containsQuad(bNodeHandledQuad)) {
                this.quadStore.addQuad(bNodeHandledQuad);
            }
        }

        if (done) {
            window.setTimeout(function() {
                handler(data);
            }, 1);
        }
        if (error) {
            console.error(error);
        }
    }.bind(this));
};

sc.data.Databroker.prototype.parseRdf = function(data, format, handler) {
    var parsers = this.parsersByType.get(format, true);
    if (parsers.length == 0) parsers = this.parsers;

    var success = false;
    for (var i=0, len=parsers.length; i<len; i++) {
        var parser = parsers[i];

        try {
            parser.parse(data, null, handler);
            success = true;
            break;
        }
        catch (e) {
            console.warn('Parser', parser, 'failed on data', data, 'with error', e);
        }
    }

    if (!success) {
        console.error('RDF could not be parsed', data);
    }
};

sc.data.Databroker.prototype.registerParser = function(parser) {
    if (parser.databroker != this) {
        throw "Parser must be instantiated with a reference to this databroker";
    }

    this.parsers.push(parser);
    goog.structs.forEach(parser.parseableTypes, function(type) {
        this.parsersByType.get(type).push(parser);

        this.parseableTypes.add(type);
    }, this);
};

sc.data.Databroker.prototype.registerSerializer = function(serializer) {
    if (serializer.databroker != this) {
        throw "Serializer must be instantiated with a reference to this databroker";
    }

    this.serializers.push(serializer);
    goog.structs.forEach(serializer.serializableTypes, function(type) {
        this.serializersByType.get(type).push(serializer);
    }, this);
};

/**
 * Adds a new locally created quad to the quad store, and keeps a reference
 * to it as new. If the quad was not locally created, the quad store's
 * addQuad method should be called instead.
 *
 * @param {sc.data.Quad} quad The quad to be added.
 */
sc.data.Databroker.prototype.addNewQuad = function(quad) {
    var isActuallyNew = !this.quadStore.containsQuad(quad);

    this.quadStore.addQuad(quad);
    if (isActuallyNew) {
        this.newQuadStore.addQuad(quad);
    }

    return this;
};

sc.data.Databroker.prototype.addNewQuads = function(quads) {
    goog.structs.forEach(quads, this.addNewQuad, this);

    return this;
};

sc.data.Databroker.prototype.deleteQuad = function(quad) {
    this.quadStore.removeQuad(quad);
    this.deletedQuadsStore.addQuad(quad);

    return this;
};

sc.data.Databroker.prototype.deleteQuads = function(quads) {
    goog.structs.forEach(quads, this.deleteQuad, this);

    return this;
};

sc.data.Databroker.prototype.dumpQuadStore = function(opt_outputType) {
    return this.dumpQuads(this.quadStore.getQuads(), opt_outputType);
};

sc.data.Databroker.prototype.serializeQuads = function(quads, opt_format, handler) {
    var format = opt_format || 'application/rdf+xml';

    var serializers = this.serializersByType.get(format);
    for (var i=0, len=serializers.length; i<len; i++) {
        var serializer = serializers[i];

        serializer.serialize(quads, opt_format, handler);
        break;
    }
};

/**
 * Returns a set of urls to request for resources, including guesses if no data is known about the resources
 * @param {Array.<string>} uris
 * @return {goog.structs.Set.<string>}
 */
sc.data.Databroker.prototype.getUrlsToRequestForResources = function(uris, opt_forceReload, opt_noGuesses) {
    var urlsToRequest = new goog.structs.Set();
    var allUris = new goog.structs.Set();

    for (var i = 0, len = uris.length; i < len; i++) {
        var uri = uris[i];
        allUris.add(uri);

        allUris.addAll(this.dataModel.findResourcesForCanvas(uri));

        var resource = this.getResource(uri);
        if (resource.hasAnyType(sc.data.DataModel.VOCABULARY.canvasTypes)) {
            var manifestUris = this.dataModel.findManifestsContainingCanvas(uri);
            goog.structs.forEach(manifestUris, function(manifestUri) {
                allUris.addAll(this.dataModel.findManuscriptAggregationUris(manifestUri));
            }, this);
        }
        else if (resource.hasAnyType('oa:SpecificResource') && this.getResourceDescribers(resource.uri) === 0) {
            allUris.add(resource.getOneProperty('oa:hasSource'));
        }
    }

    uris = allUris.getValues();

    for (var i = 0, leni = uris.length; i < leni; i++) {
        var uri = uris[i];

        var describers = this.getResourceDescribers(uri);

        if (describers.length > 0) {
            for (var j = 0, lenj = describers.length; j < lenj; j++) {
                var describer = describers[j];

                if (!opt_forceReload || !this.receivedUrls.contains(describer)) {
                    urlsToRequest.add(describer);
                }
            }
        }
        else if (uri.substring(0, 9) == 'urn:uuid:') {
            continue;
        }
        else if (!opt_noGuesses) {
            urlGuesses = this.guessResourceUrls(uri);
            for (var j = 0, lenj = urlGuesses.length; j < lenj; j++) {
                var url = urlGuesses[j];

                if ((!opt_forceReload || !this.receivedUrls.contains(url)) &&
                    !this.failedUrls.contains(url)) {
                    urlsToRequest.add(url);
                }
            }
        }
    }

    return urlsToRequest;
};

/**
 * Returns a set of urls to request for a resource, including guesses if no data is known about the resource
 * @param {string} uri
 * @return {goog.structs.Set.<string>}
 */
sc.data.Databroker.prototype.getUrlsToRequestForResource = function(uri, opt_forceReload) {
    return this.getUrlsToRequestForResources([uri], opt_forceReload);
};

/**
 * Returns a jQuery.deferred object which will be updated as data is gathered about a resource
 * .done() and .progress() may be called on the returned object to add callback handlers for the loaded
 * resource.
 * @param {string} uri
 * @param {Array|goog.structs.Collection} opt_urlsToRequest A list of urls which should be queried for the resource.
 * @return {jQuery.deferred}
 */
sc.data.Databroker.prototype.getDeferredResource = function(uri, opt_urlsToRequest) {
    var self = this;

    if (uri instanceof sc.data.Resource) {
        uri = uri.uri;
    }
    else {
        uri = sc.data.Term.unwrapUri(uri);
    }

    var deferredResource = jQuery.Deferred();

    window.setTimeout(function() {
        if (opt_urlsToRequest) {
            var urlsToRequest = this.getUrlsToRequestForResource(uri, null, true);
            urlsToRequest.addAll(opt_urlsToRequest);
        }
        else {
            var urlsToRequest = this.getUrlsToRequestForResource(uri);
        }
        if (urlsToRequest.getCount() == 0) {
            deferredResource.resolveWith(this, [this.getResource(uri), this]);
        }
        else {
            if (this.knowsAboutResource(uri)) {
                deferredResource.notifyWith(this, [this.getResource(uri), this]);
            }

            var deferredCollection = new sc.util.DeferredCollection();

            var urlsToRequestArr = urlsToRequest.getValues();
            for (var i = 0, len = urlsToRequestArr.length; i < len; i++) {
                var url = urlsToRequestArr[i];

                var jqXhr = this.fetchRdf(url, function(rdf, data) {
                    deferredResource.notifyWith(this, [self.getResource(uri), self]);
                }, true);
                deferredCollection.add(jqXhr);
            }

            deferredCollection.allComplete(function(deferreds, collection) {
                if (! collection.areAllFailed()) {
                    deferredResource.resolveWith(this, [self.getResource(uri), self]);
                }
            });

            deferredCollection.allFailed(function(deferreds, collection) {
                var resource = self.getResource(uri);

                if (resource.hasPredicate('ore:isDescribedBy')) {
                    deferredResource.rejectWith(this, [resource, self]);
                }
                else {
                    deferredResource.resolveWith(this, [resource, self]);
                }
            });
        }
    }.bind(this), 0);

    return deferredResource;
};

sc.data.Databroker.prototype.knowsAboutResource = function(uri) {
    var resource = this.getResource(uri);

    var numQuads = 0;

    goog.structs.forEach(this.getEquivalentUris(resource.bracketedUri), function(uri) {
        numQuads += this.quadStore.numQuadsMatchingQuery(uri, null, null, null) +
                    this.quadStore.numQuadsMatchingQuery(null, uri, null, null) +
                    this.quadStore.numQuadsMatchingQuery(null, null, uri, null) +
                    this.quadStore.numQuadsMatchingQuery(null, null, null, uri);
    }, this);
    
    return numQuads > 0;
};

sc.data.Databroker.prototype.hasResourceData = function(uri) {
    var resource = this.getResource(uri);

    var numQuads = 0;

    goog.structs.forEach(this.getEquivalentUris(resource.bracketedUri), function(uri) {
        numQuads += this.quadStore.numQuadsMatchingQuery(uri, null, null, null);
    }, this);
    
    return numQuads > 0;
};

/**
 * @param {Array.<string>} the uris of the resources desired.
 * @return {sc.util.DeferredCollection}
 */
sc.data.Databroker.prototype.getDeferredResourceCollection = function(uris) {
    var collection = new sc.util.DeferredCollection();

    for (var i = 0, len = uris.length; i < len; i++) {
        var uri = uris[i];

        collection.add(this.getDeferredResource(uri));
    }

    return collection;
};

sc.data.Databroker.prototype.getResource = function(uri) {
    goog.asserts.assert(uri != null, 'uri passed to sc.data.Databroker#getResource is null or undefined');

    var graph = new sc.data.Graph(this.quadStore, null);

    if (uri instanceof sc.data.Resource) {
        return new sc.data.Resource(this, graph, uri.uri);
    }
    else {
        uri = sc.data.Term.unwrapUri(uri);
        return new sc.data.Resource(this, graph, uri);
    }
};

sc.data.Databroker.prototype.createResource = function(uri, type) {
    var resource = this.getResource(uri || this.createUuid());

    if (this.hasResourceData(resource)) {
        throw "Resource " + resource.uri + " already exists";
    }

    if (this.user) {
        resource.addProperty('dc:creator', this.user);
    }

    resource.addProperty('dc:created', sc.data.DateTimeLiteral(new Date()));

    if (type) {
        resource.addProperty('rdf:type', type);
    }

    this.newResourceUris.add(resource.bracketedUri);
    
    return resource;
};

sc.data.Databroker.prototype.getEquivalentUris = function(uri_s) {
    if (jQuery.isArray(uri_s)) {
        var uris = uri_s;
    }
    else {
        var uris = [uri_s];
    }
    
    var sameUris = new goog.structs.Set();
    
    for (var i=0, len=uris.length; i<len; i++) {
        var uri = uris[i];
        uri = sc.data.Term.wrapUri(uri);
        
        sameUris.add(uri);
        
        if (!sc.data.Term.isUri(uri)) {
            continue
        }

        sameUris.addAll(this.quadStore.subjectsSetMatchingQuery(
            null, this.namespaces.expand('owl', 'sameAs'), uri, null));
        sameUris.addAll(this.quadStore.objectsSetMatchingQuery(
            uri, this.namespaces.expand('owl', 'sameAs'), null, null));
    }
    
    if (sc.data.Term.isWrappedUri(uris[0])) {
        return sameUris.getValues();
    }
    else {
        return sc.data.Term.unwrapUri(sameUris.getValues());
    }
};

sc.data.Databroker.prototype.areEquivalentUris = function(uriA, uriB) {
    uriA = sc.data.Term.wrapUri(uriA);
    uriB = sc.data.Term.wrapUri(uriB);
    
    if (uriA == uriB) {
        return true;
    }

    var numQuads = this.quadStore.numQuadsMatchingQuery(uriA, this.namespaces.expand('owl', 'sameAs'), uriB, null) +
        this.quadStore.numQuadsMatchingQuery(uriB, this.namespaces.expand('owl', 'sameAs'), uriA, null);
    
    return numQuads > 0;
};

sc.data.Databroker.prototype.getUrisSetWithProperty = function(predicate, object) {
    var equivalentObjects = this.getEquivalentUris(object);
    
    var uris = new goog.structs.Set();
    
    for (var i=0, len=equivalentObjects.length; i<len; i++) {
        var equivalentObject = equivalentObjects[i];
        
        uris.addAll(this.quadStore.subjectsSetMatchingQuery(
            null,
            this.namespaces.autoExpand(predicate),
            this.namespaces.autoExpand(object),
            null));
    }
    
    return uris;
};

sc.data.Databroker.prototype.getUrisWithProperty = function(predicate, object) {
    var uris = this.getUrisSetWithProperty(predicate, object);
    
    return sc.data.Term.unwrapUri(uris.getValues());
};

sc.data.Databroker.prototype.getPropertiesSetForResource = function(uri, predicate) {
    var equivalentUris = this.getEquivalentUris(uri);
    
    var properties = new goog.structs.Set();
    
    for (var i=0, len=equivalentUris.length; i<len; i++) {
        var equivalentUri = equivalentUris[i];

        properties.addAll(this.quadStore.objectsSetMatchingQuery(
            sc.data.Term.wrapUri(equivalentUri),
            this.namespaces.autoExpand(predicate),
            null,
            null));
    }
    
    return properties;
};

sc.data.Databroker.prototype.getPropertiesForResource = function(uri, predicate) {
    var properties = this.getPropertiesSetForResource(uri, predicate);
    
    if (sc.data.Term.isWrappedUri(uri)) {
        return properties.getValues();
    }
    else {
        return sc.data.Term.unwrapUri(properties.getValues());
    }
};

sc.data.Databroker.FILE_EXTENSION_RE = /^(.*)\.(\w+)$/;
/**
 * When a resource does not specify its describer, this method guesses the url by trying
 * common extensions. Will not return known bad urls, and checks to see if the correct url
 * is already known from previous requests.
 */
sc.data.Databroker.prototype.guessResourceUrls = function(uri) {
    var appendExtensions = function(uri) {
        if (sc.data.Databroker.FILE_EXTENSION_RE.test(uri) || goog.string.endsWith(uri, '/')) {
            return [uri];
        }
        else {
            return [
                uri,
                uri + '.xml',
                uri + '.rdf'//,
                //uri + '.n3',
                //uri + '.ttl'
            ];
        }
    };
    
    var guesses = [];
    
    var equivalentUris = this.getEquivalentUris(uri);
    for (var i=0, len=equivalentUris.length; i<len; i++) {
        var equivalentUri = equivalentUris[i];
        
        guesses = guesses.concat(appendExtensions(equivalentUri));
    }
    
    var filteredGuesses = [];

    for (var i = 0, len = guesses.length; i < len; i++) {
        var guess = guesses[i];

        if (this.receivedUrls.contains(guess)) {
            return [guess];
        }
    }

    for (var i = 0, len = guesses.length; i < len; i++) {
        var guess = guesses[i];

        if (! this.failedUrls.contains(guess) &&
            sc.data.Term.isUri(guess)) {
            filteredGuesses.push(guess);
        }
    }

    return filteredGuesses;
};

sc.data.Databroker.prototype.getResourceDescribers = function(uri) {
    uri = sc.data.Term.wrapUri(uri);
    
    var describerUrls = this.getPropertiesSetForResource(uri, 'ore:isDescribedBy');
    if (describerUrls.getCount() == 0) {
        describerUrls.addAll(this.getUrisSetWithProperty('ore:describes', uri));
    }
    
    return sc.data.Term.unwrapUri(describerUrls.getValues());
};

sc.data.Databroker.prototype.getResourcesDescribedByUrl = function(url) {
    url = sc.data.Term.wrapUri(url);

    var uris = new goog.structs.Set();

    uris.addAll(this.quadStore.objectsSetMatchingQuery(
        url,
        this.namespaces.expand('ore', 'describes'),
        null,
        null));
    uris.addAll(this.quadStore.subjectsSetMatchingQuery(
        null,
        this.namespaces.expand('ore', 'isDescribedBy'),
        url,
        null));
    
    return sc.data.Term.unwrapUri(uris.getValues());
};

/**
 * Iterates over an rdf:list and returns an array of the list item uris in order
 * @param {string} listUri
 * @return {Array.<string>}
 */
sc.data.Databroker.prototype.getListUrisInOrder = function(listUri) {
    var list = this.getResource(listUri);
    var uris = [];

    var firstUri = list.getOneProperty('rdf:first');
    if (!firstUri) {
        return [];
    }
    uris.push(firstUri);

    var restUri = list.getOneProperty('rdf:rest');
    
    var nilUri = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil';

    while (restUri && restUri != nilUri) {
        var rest = this.getResource(restUri);
        firstUri = rest.getOneProperty('rdf:first');

        if (firstUri) {
            uris.push(firstUri);
        }
        else {
            console.warn('Malformed sequence:', list.uri);
        }

        restUri = rest.getOneProperty('rdf:rest');
    }

    return uris;
};

sc.data.Databroker.prototype.getImageSrc = function(uri, opt_width, opt_height) {
    return this.options.imageSourceGenerator(uri, opt_width, opt_height);
};

sc.data.Databroker.prototype.createUuid = function() {
    var uuid = 'urn:uuid:' + goog.string.getRandomString() +
                goog.string.getRandomString() + goog.string.getRandomString();

    if (! this.knowsAboutResource(uuid)) {
        return uuid;
    }
    else {
        return this.createUuid();
    }
};

sc.data.Databroker.prototype.sync = function() {
    console.warn('Databroker.sync being called...');
    return this.syncService.requestSync();
};

sc.data.Databroker.prototype.compareUrisByTitle = function(a, b) {
    return sc.data.Resource.compareByTitle(this.getResource(a), this.getResource(b));
};

sc.data.Databroker.prototype.sortUrisByTitle = function(uris) {
    goog.array.sort(uris, this.compareUrisByTitle.bind(this));
};

sc.data.Databroker.getUri = function(obj) {
    if (obj == null) {
        return null;
    }
    else if (goog.isString(obj)) {
        return sc.data.Term.unwrapUri(obj);
    }
    else if (goog.isFunction(obj.getUri)) {
        return obj.getUri();
    }
    else if (obj instanceof sc.data.Uri) {
        return obj.unwrapped();
    }
};

    