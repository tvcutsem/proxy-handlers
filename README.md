This library provides a number of subclassable ECMAScript 6 Proxy handlers.

The goal is to simplify writing complete and correct Proxy handlers.

To run:

```
node --harmony
> var Handlers = require('proxy-handlers');
```

This library defines three constructor functions:

  * `DelegatingHandler`
  * `ForwardingHandler`
  * `VirtualHandler`

Each defines a generic type of proxy handler from which your own proxy
handlers can inherit.

All handlers exported by this library are modeled as standard JavaScript
constructor functions, and can be "subclassed" using standard JavaScript
prototype-based inheritance.

:warning: This library is based on a [draft ECMAScript proposal](http://wiki.ecmascript.org/doku.php?id=harmony:virtual_object_api). However, note that this draft proposal is no longer on track for standardization and that the handlers defined by this library are not built-in to ECMAScript 6.

# DelegatingHandler

Subclass this handler if your proxy wraps a target object, and you want your
proxy to be able to serve as a prototype for other objects. Intercepted property
gets, sets and method invocations are forwarded to the target with `this` bound
to the original "receiver" object (which may be the proxy object).

### Example

```js
function Logger(){};
Logger.prototype = Object.create(DelegatingHandler.prototype);
Logger.prototype.defineProperty = function(target, name, desc) {
  console.log("updated: "+name); // log the update
  // perform update on wrapped target (super-send)
  return DelegatingHandler.prototype.defineProperty(target, name, desc);
}
 
var p = DelegatingHandler.proxyFor.call(Logger, {
  foo: 42,
  bar: function(v) { this.foo = v; }
});
 
// triggers "defineProperty" trap, logs the update:
Object.defineProperty(p, "foo", {value:43}); // updated: "foo"

// triggers the "set" trap, which in turn calls "defineProperty",
// so this update is logged as well:
p.foo = 44; // updated: "foo"
 
// DelegatingHandler binds |this| inside the bar() method to p,
// so the property update inside that method is logged as well:
p.bar(45); // updated: "foo"
```

# ForwardingHandler

Subclass this handler if your proxy wraps a target object, and you want to
ensure that `this` is always bound to the target object inside forwarded method
calls or accessors, never to the proxy object. Proxies using this handler
should not be used as prototypes, as they ignore the initial receiver object
upon forwarding.

### Example

```js
function Logger() {};
Logger.prototype = Object.create(ForwardingHandler.prototype);
Logger.prototype.defineProperty = function(target, name, desc) {
  console.log("updated: "+name); // log the update
  // perform update on wrapped target (super-send)
  return ForwardingHandler.prototype.defineProperty(target, name, desc);
};
 
var p = DelegatingHandler.proxyFor.call(Logger, {
  foo: 42,
  bar: function(v) { this.foo = v; }
});
 
// triggers "defineProperty" trap, logs the update:
Object.defineProperty(p, "foo", {value:43}); // updated: "foo"
 
// triggers the "set" trap, which in turn calls "defineProperty",
// so this update is logged as well:
p.foo = 44; // updated: "foo"
 
// ForwardingHandler binds |this| inside the bar() method to the target,
// so the property update inside that method will not be logged:
p.bar(45); // update not logged
```
  
# VirtualHandler

Subclass this handler if your proxy does not actually wrap a target object.
In other words, your proxy represents a “virtual object” that does not have a
useful backing target object. A `VirtualHandler` never forwards operations to
its target.

### Example

Say we want to develop a “LazyObject” abstraction that only instantiates an object the first time it is accessed:

```js
// thunk will be called to initialize the object the first
// time it is accessed:
var thunk = function() { return {foo:42}; };
 
// create a LazyObject proxy with the thunk, and an empty target object
// (the target object is irrelevant for this abstraction):
var dummyTarget = {};
var p = LazyObject.proxyFor(dummyTarget, thunk);
 
p.foo // calls thunk() to initialize the object, then returns 42
```

We might implement the `LazyObject` handler as a simple subclass of
`DelegatingHandler`:

```js
function LazyObject(thunk) {
  this.thunk = thunk;
  this.val = undefined;
};
LazyObject.prototype = Object.create(DelegatingHandler.prototype);
LazyObject.prototype.force = function() {
  if (this.thunk !== null) {
    this.val = this.thunk.call(undefined);
    this.thunk = null;
  }
};
LazyObject.prototype.getOwnPropertyDescriptor = function(target, name) {
  this.force(); // ensure the object is initialized
  // forward the operation not to the dummy target, but to the
  // initialized object stored in this.val:
  return Reflect.getOwnPropertyDescriptor(this.val, name);
};
```

This code works fine for property accesses, which are internally based on
`getOwnPropertyDescriptor`. However, to our surprise, property update appears
broken:

```js
var thunk = function() { return {foo:42}; };
var dummyTarget = {};
var p = DelegatingHandler.proxyFor.call(LazyObject, dummyTarget, thunk);
 
p.foo = 43;
p.foo // 42 !?
 
dummyTarget.foo // 43 !?
```

What happened? The expression `p.foo = 43` triggered the proxy’s `set` trap.
Since `LazyObject` is a subclass of `DelegatingHandler`, it inherits that
handler’s default implementation for `set`, which is defined in terms of
`defineProperty`. Since `defineProperty` was not overridden by our `LazyObject`
class, the default implementation is used, which is to forward to the target.
Hence, the "foo" property will be defined on `dummyTarget` and our lazy object
does not even get initialized. When we subsequently ask what the value of `p.foo`
is, the proxy does initialize the object and returns `42`, because
`getOwnPropertyDescriptor` was correctly overridden and reroutes the request to
the initialized object.

The `VirtualHandler` exists to prevent subtle bugs such as these.
`VirtualHandler` is basically a subclass of `DelegatingHandler` that overrides all
"fundamental" traps such that they don’t forward by default, but instead throw
an error, signaling to the programmer that he or she probably forgot to override
a method:

```js
function LazyObject(thunk) {
  this.thunk = thunk;
  this.val = undefined;
};
LazyObject.prototype = Object.create(VirtualHandler.prototype);
// initialize as before
 
var thunk = function() { return {foo:42}; };
var dummyTarget = {};
var p = LazyObject.proxyFor(dummyTarget, thunk);
 
p.foo = 43; // error: "getPrototypeOf"/"defineProperty" not implemented
```

To make the `LazyObject` abstraction work reliably, the author must override all
fundamental traps and make sure they are all “rerouted” to the initialized
object instead of the dummy target:

```js
function LazyObject(thunk) {
  this.thunk = thunk;
  this.val = undefined;
};
LazyObject.prototype = Object.create(VirtualHandler.prototype);
LazyObject.prototype.force = function() {
  if (this.thunk !== null) {
    this.val = this.thunk.call(undefined);
    this.thunk = null;
  }
};
LazyObject.prototype.getOwnPropertyDescriptor = function(target, name) {
  this.force();
  return Reflect.getOwnPropertyDescriptor(this.val, name);
};
LazyObject.prototype.defineProperty = function(target, name, desc) {
  this.force();
  return Reflect.defineProperty(this.val, name, desc);
};
LazyObject.prototype.getPrototypeOf = function(target) {
  this.force();
  return Reflect.getPrototypeOf(this.val);
};
... // and so on for all other fundamental traps
```

# Dependencies

Given the lack of built-in support for proxies or the Reflect module
in current browsers, this library requires the
[harmony-reflect](https://github.com/tvcutsem/harmony-reflect) library
as its main dependency (if you use the NPM package manager, this is handled
automatically).
