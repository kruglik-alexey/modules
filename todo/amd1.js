define(function(require) {
    var foo = require('foo');
    var bar = require('bar').default;
    var {baz} = require('baz');

    return foo(bar);
});
