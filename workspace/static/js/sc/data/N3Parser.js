goog.provide('sc.data.N3Parser');

goog.require('sc.data.Parser');
goog.require('n3.parser');
goog.require('sc.util.Namespaces');
goog.require('goog.asserts');

sc.data.N3Parser = function(databroker) {
    sc.data.Parser.call(this, databroker);

    this.parser = new N3Parser();

    if (Worker != null && Blob != null) {
        try {
            goog.asserts.assert(goog.global.STATIC_URL != null);
            // Apologies for the inline code, but it's necessary due to cross-site restrictions
            this.workerBlob = new Blob([
                "var STATIC_URL = '" + goog.global.STATIC_URL.replace(/'/g, "\\'") + "';\n\
                importScripts(STATIC_URL + 'js/sc/data/N3ParserWorker.js');\n"
            ], {'type': 'text/javascript'});
            this.workerBlobUrl = window.URL.createObjectURL(this.workerBlob);

            this.webWorkerEnabled = true;
        }
        catch (e) {
            console.error('Web worker blob failed', e);
            this.webWorkerEnabled = false;
        }
    }
    else {
        this.webWorkerEnabled = false;
    }
};
goog.inherits(sc.data.N3Parser, sc.data.Parser);

sc.data.N3Parser.prototype.parseableTypes = new goog.structs.Set([
    'text/turtle',
    'text/n3'
]);

sc.data.N3Parser.prototype.parse = function(data, context, handler) {
    if (this.webWorkerEnabled) {
        try {
            this.parseThreaded(data, context, handler);
        }
        catch (e) {
            console.warn('Web worker parsing failed', e, 'reverting to standard implementation');
            this.parseStandard(data, context, handler);
        }
    }
    else {
        this.parseStandard(data, context, handler);
    }
};

sc.data.N3Parser.prototype.parseStandard = function(data, context, handler) {
    this.parser.parse(data, function(error, triple) {
        this._n3ParserHandler(error, triple, handler);
    }.bind(this));
};

sc.data.N3Parser.prototype._n3ParserHandler = function(error, triple, handler) {
    setTimeout(function() {
        if (triple) {
            handler([this._tripleToQuad(triple)], false);
        }
        else if (error) {
            handler([], false, error);
        }
        else {
            handler([], true);
        }
    }.bind(this), 1);
};

sc.data.N3Parser.prototype.parseThreaded = function(data, context, handler) {
    var worker = new Worker(this.workerBlobUrl);

    worker.addEventListener('message', function(e) {
        var o = e.data;
        var error = o.error;
        var triple = o.triple;

        this._n3ParserHandler(error, triple, handler);

        if (!triple && !error) {
            worker.terminate();
        }
    }.bind(this));

    worker.postMessage(data);
};

sc.data.N3Parser._termWrapper = function(str) {
    if (!sc.util.Namespaces.isQuoteWrapped(str)) {
        return sc.util.Namespaces.angleBracketWrap(str);
    }
    else {
        return str;
    }
};

sc.data.N3Parser.prototype._tripleToQuad = function(triple, context) {
    var wrap = sc.data.N3Parser._termWrapper;

    var subject = wrap(triple.subject);
    var predicate = wrap(triple.predicate);
    var object = wrap(triple.object);

    return new sc.data.Quad(subject, predicate, object, context);
};