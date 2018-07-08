var foo = require('foo');
var bar = require('bar').default;
var {baz, zzz, xxx: yyy} = require('baz');

module.exports = foo(bar);
