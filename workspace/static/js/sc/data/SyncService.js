goog.provide('sc.data.SyncService');

goog.require('goog.net.Cookies');
goog.require('sc.data.ConjunctiveQuadStore');

/**
 * @author sbradsha@drew.edu (Shannon Bradshaw)
 * @author tandres@drew.edu (Tim Andres)
 * @author lmoss1@drew.edu (Lucy Moss)
 */
sc.data.SyncService = function(options) {
    this.databroker = null; // Should be set by owning databroker

    this.options = {};
    goog.object.extend(this.options, sc.data.SyncService.DEFAULT_OPTIONS, options || {});

    this.cookies = new goog.net.Cookies(window.document);
};

sc.data.SyncService.DEFAULT_OPTIONS = {
    dmBaseUri: "http://dm.drew.edu/store/",
    restHost: location.host,
    restBasePath: 'store',
    restProtocol: 'http',
    restTextPath: 'texts',
    restProjectPath: 'projects',
    restResourcePath: 'resources',
    restAnnotationPath: 'annotations',
    restUserPath: 'users',
    restSearchPath: 'search',
    restAutocompletePath: 'search_autocomplete',
    restCanvasPath: 'canvases'
};

sc.data.SyncService.RESTYPE = {
    'text': 0, 
    'project': 1, 
    'annotation': 2, 
    'user': 3, 
    'resource': 4,
    'search': 5,
    'search_autocomplete': 6,
    'canvas': 7
};

sc.data.SyncService.prototype.requestSync = function() {
    this.postNewResources();

    this.putModifiedResources();

    this.deleteDeletedResources();
};

sc.data.SyncService.prototype.createTextHttpUri = function() {
    var uuid = this.databroker.createUuid().replace("/urn\:uuid\:/", "");
    var uri = this.textBaseUri.replace(/\/+$/, "") // that property doesn't exist in this class or the databroker... ?
        + "/"
        + uuid;
    return uri;
};


sc.data.SyncService.prototype._restUri = function(baseUri, projectUri, resType, resUri, params) {
    var url = baseUri.replace(/\/+$/, "");
    url += "/";

    if (projectUri != null) {
        url += this.options.restProjectPath.replace(/^\/+|\/+$/g, "");
        url += "/";
        url += projectUri;
        url += "/";
    }

    if (resType == sc.data.SyncService.RESTYPE.text) {
        url += this.options.restTextPath.replace(/^\/+|\/+$/g, "");
        url += "/";
    } else if (resType == sc.data.SyncService.RESTYPE.resource) {
        url += this.options.restResourcePath.replace(/^\/+|\/+$/g, "");
        url += "/";
    } else if (resType == sc.data.SyncService.RESTYPE.annotation) {
        url += this.options.restAnnotationPath.replace(/^\/+|\/+$/g, "");
        url += "/";
    } else if (resType == sc.data.SyncService.RESTYPE.user) {
        url += this.options.restUserPath.replace(/^\/+|\/+$/g, "");
        url += "/";
    }
    else if (resType == sc.data.SyncService.RESTYPE.project) {
        // pass
    }
    else if (resType == sc.data.SyncService.RESTYPE.search) {
        url += this.options.restSearchPath.replace(/^\/+|\/+$/g, "");
    }
    else if (resType == sc.data.SyncService.RESTYPE.search_autocomplete) {
        url += this.options.restAutocompletePath.replace(/^\/+|\/+$/g, "");
    }
    else if (resType == sc.data.SyncService.RESTYPE.canvas) {
        url += this.options.restCanvasPath.replace(/^\/+|\/+$/g, "");
    }

    if (resUri != null) {
        url += resUri;
    } 
    if (params != null) {
        url += "?" + jQuery.param(params);
    }

    return url;
};


sc.data.SyncService.prototype.restUrl = function(projectUri,resType, resUri, params) {
    var baseUrl = this.options.restProtocol
        + "://"
        + this.options.restHost.replace(/\/+$/, "")
        + "/"
        + this.options.restBasePath.replace(/^\/+|\/+$/g, "")
        + "/";
    return this._restUri(baseUrl, projectUri, resType, resUri, params);
};


sc.data.SyncService.prototype.restUri = function(projectUri, resType, resUri, params) {
    return this._restUri(this.options.dmBaseUri, projectUri, resType, resUri, params);
};

sc.data.SyncService.prototype.getModifiedResourceUris = function() {
    var subjectsOfNewQuads = this.databroker.newQuadStore.subjectsSetMatchingQuery(null, null, null, null);
    subjectsOfNewQuads.addAll(this.databroker.deletedQuadsStore.subjectsSetMatchingQuery(null, null, null, null));

    return subjectsOfNewQuads.difference(this.databroker.newResourceUris).difference(this.databroker.deletedResourceUris);
};

sc.data.SyncService.prototype.postNewResources = function() {
    var conjunctiveStore = new sc.data.ConjunctiveQuadStore([this.databroker.quadStore, this.databroker.deletedQuadsStore]);
    var graph = new sc.data.Graph(conjunctiveStore, null);

    var urisToRemove = new goog.structs.Set();

    goog.structs.forEach(this.databroker.newResourceUris, function(uri) {
        var conjunctiveResource = new sc.data.Resource(this.databroker, graph, uri);

        if (conjunctiveResource.hasAnyType('oa:SpecificResource', 'oa:TextQuoteSelector', 'oa:SvgSelector')) {
            urisToRemove.add(uri);
        }
        else {
            this.sendResource(uri, 'POST', function() {
                this.databroker.newResourceUris.remove(uri);
            }.bind(this));
        }
    }, this);

    this.databroker.newResourceUris.removeAll(urisToRemove);
};

sc.data.SyncService.prototype.putModifiedResources = function() {
    var conjunctiveStore = new sc.data.ConjunctiveQuadStore([this.databroker.quadStore, this.databroker.deletedQuadsStore]);
    var graph = new sc.data.Graph(conjunctiveStore, null);

    goog.structs.forEach(this.getModifiedResourceUris(), function(uri) {
        var conjunctiveResource = new sc.data.Resource(this.databroker, graph, uri);
        var resource = this.databroker.getResource(uri);

        if (resource.hasType('foaf:Agent')) {
            this.databroker.deletedQuadsStore.removeQuadsMatchingQuery(resource.bracketedUri, this.databroker.namespaces.expand('dm', 'lastOpenProject'), null, null);
            this.databroker.deletedQuadsStore.removeQuadsMatchingQuery(resource.bracketedUri, this.databroker.namespaces.expand('dc', 'modified'), null, null);
        }

        if (conjunctiveResource.hasAnyType('oa:TextQuoteSelector', 'oa:SvgSelector')) {
            var specificResource = resource.getReferencingResources('oa:hasSelector')[0];
            if (specificResource) {
                this.sendResource(specificResource.uri, 'PUT');
            }
        }
        else if (conjunctiveResource.getProperties('rdf:type').length == 0) {
            this.databroker.newQuadStore.removeQuadsMatchingQuery(resource.bracketedUri, null, null, null);
        }
        else {
            this.sendResource(uri, 'PUT');
        }
    }, this);
};

sc.data.SyncService.prototype.deleteDeletedResources = function() {
    var quadsToRemove = []

    goog.structs.forEach(this.databroker.deletedResourceUris, function(uri) {
        quadsToRemove = quadsToRemove.concat(this.databroker.deletedQuadsStore.query(sc.data.Term.wrapUri(uri), null, null, null));
    });

    if (quadsToRemove.length > 0) {
        var currentProject = this.databroker.projectController.currentProject;
        var url = this.restUrl(currentProject.uri, sc.data.SyncService.RESTYPE.project, null, null) + 'remove_triples';

        this.sendQuads(quadsToRemove, url, 'PUT', null, function() {
            this.databroker.deletedQuadsStore.removeQuads(quadsToRemove);
            this.databroker.deletedResourceUris.clear();
        }, function() {
            // Error
        });
    }
};

sc.data.SyncService.prototype.sendResource = function(uri, method, successHandler) {
    var resource = this.databroker.getResource(uri);

    var conjunctiveStore = new sc.data.ConjunctiveQuadStore([this.databroker.quadStore, this.databroker.deletedQuadsStore]);
    var graph = new sc.data.Graph(conjunctiveStore, null);
    var conjunctiveResource = new sc.data.Resource(this.databroker, graph, uri);

    var dataModel = this.databroker.dataModel;
    var newQuadStore = this.databroker.newQuadStore;
    var deletedQuadsStore = this.databroker.deletedQuadsStore;
    var projectController = this.databroker.projectController;
    var currentProject = projectController.currentProject;
    var PERMISSIONS = sc.data.ProjectController.PERMISSIONS;
    var VOCABULARY = sc.data.DataModel.VOCABULARY;

    var resType;
    var quadsToPost = [];
    var quadsToRemove = [];
    var url;

    if (conjunctiveResource.hasAnyType(VOCABULARY.textTypes)) {
        resType = sc.data.SyncService.RESTYPE.text;

        quadsToPost = this.databroker.dataModel.findQuadsToSyncForText(resource);
        // The back end just overwrites with new data for texts, so we can just ignore quad deletion
        newQuadStore.removeQuads(dataModel.findQuadsToSyncForText(resource, newQuadStore));
        deletedQuadsStore.removeQuads(dataModel.findQuadsToSyncForText(resource, deletedQuadsStore));

        url = this.restUrl(currentProject.uri, resType, sc.data.Term.unwrapUri(uri), null);

        console.warn('Sync 1: ' + url);
    }
    else if (conjunctiveResource.hasAnyType(VOCABULARY.canvasTypes)) {
        resType = sc.data.SyncService.RESTYPE.project;

        quadsToPost = newQuadStore.query(resource.bracketedUri, null, null, null);
        quadsToRemove = deletedQuadsStore(resource.bracketedUri, null, null, null);

        url = this.restUrl(currentProject.uri, resType, null, null);
        if (method == 'POST') {
            method = 'PUT'
        }
        console.warn('Sync 2: ' + url);
    }
    else if (conjunctiveResource.hasType('oa:Annotation')) {
        resType = sc.data.SyncService.RESTYPE.project;

        quadsToPost = dataModel.findQuadsToSyncForAnno(resource.bracketedUri);
        quadsToRemove = dataModel.findQuadsToSyncForAnno(resource.bracketedUri, deletedQuadsStore);

        url = this.restUrl(currentProject.uri, resType, null, null);
        if (method == 'POST') {
            method = 'PUT'
        }

        console.warn('Sync 3: ' + url);
    }
    else if (conjunctiveResource.hasType('dm:Project') &&
        projectController.userHasPermissionOverProject(null, resource, PERMISSIONS.update)) {
        var resType = sc.data.SyncService.RESTYPE.project;

        quadsToPost = dataModel.findQuadsToSyncForProject(resource, newQuadStore);
        quadsToRemove = dataModel.findQuadsToSyncForProject(resource, deletedQuadsStore);

        var newAggregateUris = newQuadStore.objectsSetMatchingQuery(resource.bracketedUri, this.databroker.namespaces.expand('ore', 'aggregates'), null, null);
        goog.structs.forEach(newAggregateUris, function(aggregateUri) {
            quadsToPost = quadsToPost.concat(dataModel.findMetadataQuads(this.databroker.getResource(aggregateUri)));
        }, this);

        url = this.restUrl(currentProject.uri, resType, null, null);
        if (method == 'POST') {
            method = 'PUT'
        }

        console.warn('Sync 4: ' + url);
    }
    else if (conjunctiveResource.hasType('foaf:Agent')){
        resType = sc.data.SyncService.RESTYPE.user;
        quadsToPost = dataModel.findQuadsToSyncForUser(resource, newQuadStore)
        quadsToRemove = dataModel.findQuadsToSyncForUser(resource, deletedQuadsStore)

        var username = resource.uri.split("/").pop()
        url = this.restUrl(null, resType, username, null) + "/";

        console.warn('Sync 5: ' + url);
    }
    else if (conjunctiveResource.hasType('oa:SpecificResource')) {
        resType = sc.data.SyncService.RESTYPE.project;
        quadsToPost = dataModel.findQuadsToSyncForSpecificResource(resource, newQuadStore);
        quadsToRemove = dataModel.findQuadsToSyncForSpecificResource(resource, deletedQuadsStore);

        url = this.restUrl(currentProject.uri, resType, null, null);
        if (method == 'POST') {
            method = 'PUT';
        }

        console.warn('Sync 6: ' + url);
    }
    else if (conjunctiveResource.hasAnyType('oa:TextQuoteSelector', 'oa:SvgSelector')) {
        // pass
    }
    else {
        console.error("Don't know how to sync resource " + conjunctiveResource);
        return;
    }

    if (quadsToRemove.length > 0)  {
        this.sendQuads(quadsToRemove, url + 'remove_triples', 'PUT', null, function() {
            // Success
            this.databroker.deletedQuadsStore.removeQuads(quadsToRemove);
            console.warn('Removing quads: ' + url);
        }.bind(this), function(jqXHR, textStatus, errorThrown) {
            // Error
            if (goog.string.startsWith(textStatus, '4')) {
                console.error('The following quads returned a 4xx series error when being sent to url: ' + url, quadsToPost, errorThrown);
                this.databroker.deletedQuadsStore.removeQuads(quadsToRemove);
            }
        }.bind(this));
    }

    if (quadsToPost.length > 0) {
        this.sendQuads(quadsToPost, url, method, null, function() {
            // Success
            this.databroker.hasSyncErrors = false;
            if (method == 'PUT' || method == 'POST') {
                this.databroker.newQuadStore.removeQuads(quadsToPost);
                console.warn('Sending quads: ' + url);
            }
            if (goog.isFunction(successHandler)) {
                successHandler();
            }
        }.bind(this), function(jqXHR, textStatus, errorThrown) {
            // Error
            this.databroker.hasSyncErrors = true;
            console.warn('ERROR! ' + errorThrown);
            console.warn('textStatus: ' + textStatus);
            console.warn('Has sync errors: ' + this.databroker.hasSyncErrors);
            console.warn(goog.string);
            if (goog.string.startsWith(textStatus, '4')) {
                console.error('The following quads returned a 4xx series error when being sent to url: ' + url, quadsToPost, errorThrown);
                this.databroker.newQuadStore.removeQuads(quadsToPost);
                this.databroker.newResourceUris.remove(uri);
            }
        }.bind(this));
    }
};

sc.data.SyncService.prototype.sendQuads = function(quads, url, method, format, successHandler, errorHandler) {
    successHandler = successHandler || jQuery.noop;
    errorHandler = errorHandler || jQuery.noop;
    format = format || 'text/turtle';

    goog.structs.forEach(quads, function(quad) {
        if(quad.object.match(/"".*""/)) {
            quad.object = quad.object.split('""').join('"');    
        }
    });

    this.databroker.serializeQuads(quads, format, function(data, error) {
        if (data != null) {
            jQuery.ajax({
                type: method,
                url: url,
                success: function() {
                    successHandler.apply(this, arguments);
                }.bind(this),
                error: function(jqXHR, textStatus, errorThrown) {
                    console.error('ERROR! ' + errorThrown);
                    console.error('textStatus: ' + textStatus);
                    console.error('jqXHR (full obj):');
                    console.error(jqXHR);
                    console.error('jqXHR.responseText:');
                    console.error(jqXHR.responseText);
                    console.error('data:');
                    console.error(data);
                    console.error('************ End error **********');
                    errorHandler.apply(this, arguments);
                },
                data: data,
                processData: !jQuery.isXMLDoc(data),
                headers: {
                    'X-CSRFToken': this.getCsrfToken()
                },
                contentType: format + '; charset=UTF-8'
            });
        }
        else if (error) {
            // some UI feedback here too?
            errorHandler(error);
        }
    }.bind(this));
};

sc.data.SyncService.prototype.getCsrfToken = function() {
    return this.cookies.get('csrftoken');
};

sc.data.SyncService.prototype.hasUnsavedChanges = function() {
    // The syncService isn't immediately seeing the changes in the text editor. Why?
    return this.databroker.newResourceUris.getCount() !== 0 || this.databroker.deletedResourceUris.getCount() !== 0 || this.getModifiedResourceUris().getCount() !== 0;
};

sc.data.SyncService.prototype.getProjectDownloadUrl = function(projectUri, opt_extension) {
    var url = this.restUrl(projectUri, sc.data.SyncService.RESTYPE.project, null, null);

    url += 'download.' + (opt_extension || 'ttl');

    return url;
};
