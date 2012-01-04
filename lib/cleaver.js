var debug = require('debug')('cleave'),
    tty = require('tty'),
    eve = require('eve'),
    reTrailingNewline = /[\n\r]$/,
    counter = 0;
    
// helper functions

function _configureInput(cleaver) {
    // monitor the input stream
    cleaver.input.setEncoding('utf8');
    cleaver.input.on('data', function(data) {
        // remove trailing newlines from the data
        data = data.replace(reTrailingNewline, '');
        
        var evtId = cleaver._nsevent(data),
            listeners = eve.listeners(evtId);

        debug('received data: ' + data + ', event = ' + evtId + ', ' + listeners.length + ' event listeners found');
        if (listeners.length > 0) {
            cleaver.emit(data);
        }
        else {
            cleaver.emit('nomatch');
        }
    });
    
    // resume the stream
    cleaver.input.resume();

    // if we are dealing with stdin, then set raw mode
    // tty.setRawMode(true);
}

function _makeOut(outputs) {
    return function(text) {
        (outputs || [process.stdout]).forEach(function(output) {
            output.write(text);
        });
    };
};

var Cleaver = module.exports = function(input, outputs) {
    debug('creating cleaver input = ' + (input ? 'custom stream' : 'stdin'));
    this.id = 'cleaver' + (counter++);
    this.input = input || process.stdin;
    this.out = _makeOut(outputs);
    this.actions = [];

    _configureInput(this);
};

Cleaver.prototype._next = function() {
    // remove the first and action
    this.actions.splice(0, 1);
    
    // if we have actions remaining, then run it
    debug('attempting to move to the next event');
    if (this.actions.length > 0) {
        // TODO: automatically remove actions with an invalid runner
        process.nextTick(this.actions[0].runner);
    }
    else {
        this.emit('end');
    }
    
    return this;
};

Cleaver.prototype._nsevent = function(name) {
    return this.id + (this.actions.length ? '.' + this.actions[0].action : '') + '.' + name;
};

Cleaver.prototype._queue = function(action, runner) {
    this.actions.push({
        action: action,
        run: runner
    });
    
    // if this is the first action, then run it
    if (this.actions.length === 1) {
        process.nextTick(runner);
    }
    
    return this;
};

Cleaver.prototype.emit = function(name) {
    var evtId = this._nsevent(name),
        listeners = eve.listeners(evtId);
    
    // get the listeners for the event
    debug('triggering event: ' + evtId);
    eve.apply(eve, [this._nsevent(name), this].concat(Array.prototype.slice.call(arguments, 1)));
    
    // manually remove listeners while npm contains eve 0.2.4
    listeners.forEach(function(listener) {
        eve.unbind(evtId, listener);
    });
};

Cleaver.prototype.fallback = function(callback) {
    var cleaver = this;
    
    eve.on(this._nsevent('nomatch'), function() {
        callback.apply(cleaver, Array.prototype.slice.call(arguments));

        // do the next event
        cleaver._next();
    });
    
    
    return this;
};

Cleaver.prototype.end = function(callback) {
    eve.on(this.id + '.end', callback);
    
    return this;
};

Cleaver.prototype.on = function(input, callback) {
    var cleaver = this;
    
    // register the event handler
    eve.on(this._nsevent(input), function() {
        callback.apply(cleaver, Array.prototype.slice.call(arguments));
        
        // remove the no match handler
        eve.unbind(this._nsevent('nomatch'));
        
        // splice the first action of the actions array
        cleaver._next();
    });
    
    // return this for chainability
    return this;
};

Cleaver.prototype.prompt = function(text) {
    var cleaver = this;
    
    return this._queue('prompt', function() {
        cleaver.out(text + ' ');
    });
};