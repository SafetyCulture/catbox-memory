// Load modules

var Hoek = require('hoek');


// Declare internals

var internals = {};


internals.defaults = {
    maxByteSize: 100 * 1024 * 1024          // 100MB
};

internals.setLongTimeout = function setLongTimeout(callback, timeout) {
    // setTimeout can't handle timeout values larger than a 32bit integer
    if (timeout > module.exports.maxTimeoutInterval) {
        setTimeout(function(){ internals.setLongTimeout(callback, (timeout - module.exports.maxTimeoutInterval)); }, module.exports.maxTimeoutInterval);
    } else {
        setTimeout(callback, timeout);
    }
};

// Provides a named reference for memory debugging
internals.MemoryCacheSegment = function MemoryCacheSegment () {
};

internals.MemoryCacheEntry = function MemoryCacheEntry (key, value, ttl) {

    // stringify() to prevent value from changing while in the cache
    var stringifiedValue = JSON.stringify(value);

    this.item = stringifiedValue;
    this.stored = Date.now();
    this.ttl = ttl;

    // Approximate cache entry size without value: 144 bytes
    this.byteSize = 144 + Buffer.byteLength(stringifiedValue) + Buffer.byteLength(key.segment) + Buffer.byteLength(key.id);

    this.timeoutId = null;
};


exports = module.exports = internals.Connection = function MemoryCache (options) {

    Hoek.assert(this.constructor === internals.Connection, 'Memory cache client must be instantiated using new');
    Hoek.assert(!options || options.maxByteSize === undefined || options.maxByteSize >= 0, 'Invalid cache maxByteSize value');

    this.settings = Hoek.applyToDefaults(internals.defaults, options || {});
    this.cache = null;
};

module.exports.maxTimeoutInterval = 2147483647;


internals.Connection.prototype.start = function (callback) {

    callback = Hoek.nextTick(callback);

    if (!this.cache) {
        this.cache = {};
        this.byteSize = 0;
    }

    return callback();
};


internals.Connection.prototype.stop = function () {

    this.cache = null;
    this.byteSize = 0;
    return;
};


internals.Connection.prototype.isReady = function () {

    return (!!this.cache);
};


internals.Connection.prototype.validateSegmentName = function (name) {

    if (!name) {
        return new Error('Empty string');
    }

    if (name.indexOf('\0') !== -1) {
        return new Error('Includes null character');
    }

    return null;
};


internals.Connection.prototype.get = function (key, callback) {

    callback = Hoek.nextTick(callback);

    if (!this.cache) {
        return callback(new Error('Connection not started'));
    }

    var segment = this.cache[key.segment];
    if (!segment) {
        return callback(null, null);
    }

    var envelope = segment[key.id];
    if (!envelope) {
        return callback(null, null);
    }

    var value = null;
    try {
        value = JSON.parse(envelope.item);
    }
    catch (err) {
        return callback(new Error('Bad value content'));
    }

    var result = {
        item: value,
        stored: envelope.stored,
        ttl: envelope.ttl
    };

    return callback(null, result);
};


internals.Connection.prototype.set = function (key, value, ttl, callback) {

    var self = this;

    callback = Hoek.nextTick(callback);

    if (!this.cache) {
        return callback(new Error('Connection not started'));
    }

    var envelope = null;
    try {
        envelope = new internals.MemoryCacheEntry(key, value, ttl);
    } catch (err) {
        return callback(err);
    }

    this.cache[key.segment] = this.cache[key.segment] || new internals.MemoryCacheSegment();
    var segment = this.cache[key.segment];

    var cachedItem = segment[key.id];
    if (cachedItem &&
        cachedItem.timeoutId) {

        clearTimeout(cachedItem.timeoutId);
        self.byteSize -= cachedItem.byteSize;                   // If the item existed, decrement the byteSize as the value could be different
    }

    if (this.settings.maxByteSize) {
        if (self.byteSize + envelope.byteSize > this.settings.maxByteSize) {
            return callback(new Error('Cache size limit reached'));
        }
    }

    var timeoutId = internals.setLongTimeout(function () {

        self.drop(key, function () { });
    }, ttl);

    envelope.timeoutId = timeoutId;

    segment[key.id] = envelope;
    this.byteSize += envelope.byteSize;

    return callback(null);
};


internals.Connection.prototype.drop = function (key, callback) {

    callback = Hoek.nextTick(callback);

    if (!this.cache) {
        return callback(new Error('Connection not started'));
    }

    var segment = this.cache[key.segment];
    if (segment) {
        var item = segment[key.id];

        if (item) {
            this.byteSize -= item.byteSize;
        }

        delete segment[key.id];
    }

    return callback();
};
