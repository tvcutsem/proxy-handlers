/*
Copyright (c) 2013, Tom Van Cutsem
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice, this
  list of conditions and the following disclaimer in the documentation and/or
  other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

// This file tests '../handlers.js' using the examples at:
// http://wiki.ecmascript.org/doku.php?id=harmony:virtual_object_api

var print = function(msg) {
  if(/^fail/.test(msg)) { console.error(msg); }
  else { console.log(msg); }
}
require('harmony-reflect');
var Handlers = require('../proxy_handlers.js');

function assert(b, msg) {
  print((b ? 'success: ' : 'fail: ') + msg);
}

function assertThrows(message, fn) {
  try {
    fn();
    print('fail: expected exception, but succeeded. Message was: '+message);
  } catch(e) {
    if (typeof message === "string") {
      assert(e.message === message, "assertThrows: "+e.message);      
    } else { // assume regexp
      assert(message.test(e.message), "assertThrows: "+e.message);
    }
  }
}

// the 'main' function
function test() {

  // imports
  var DelegatingHandler = Handlers.DelegatingHandler;
  var ForwardingHandler = Handlers.ForwardingHandler;
  var VirtualHandler = Handlers.VirtualHandler;

  // test inconsistency among traps with 'raw' handlers
  (function(){
    var target = {};
    var proxy = new Proxy(target, {
      getOwnPropertyDescriptor: function(target, name) {
        return { value: 42, configurable: true };
      }
    });

    var desc = Object.getOwnPropertyDescriptor(proxy,"foo");
    assert(desc.value === 42, 'proxy has a descriptor');
    assert(proxy.foo === undefined, 'proxy.foo === undefined');
    assert("foo" in proxy === false, '"foo" in proxy === false');
  }());

  // test that the inconsistency is gone when using DelegatingHandler
  (function () {
    var target = {};
    var handler = Object.create(DelegatingHandler.prototype);
    handler.getOwnPropertyDescriptor = function(target, name) {
      return { value: 42, configurable: true };
    };

    var proxy = new Proxy(target, handler);
    var desc = Object.getOwnPropertyDescriptor(proxy,"foo");
    assert(desc.value === 42, 'proxy has a descriptor');
    assert(proxy.foo === 42, 'proxy.foo === 42');
    assert("foo" in proxy === true, '"foo" in proxy === true');    
  }());


  // test proxyFor
  (function () {
    function MyHandler() {};
    // non-standard, but needed so that MyHandler inherits proxyFor method
    // from DelegatingHandler function
    MyHandler.__proto__ = DelegatingHandler;
    MyHandler.prototype = Object.create(DelegatingHandler.prototype);
    MyHandler.prototype.getOwnPropertyDescriptor = function(target, name) {
      return { value: 42, configurable: true };
    };

    var target = {};
    var proxy = MyHandler.proxyFor(target);
    assert(proxy.foo === 42, 'proxy.foo === 42 (proxyFor)');
  }());


  // test DelegatingHandler using simple Logger example
  (function () {
    var lastLogged = "";
    
    function Logger() {};
    Logger.prototype = Object.create(DelegatingHandler.prototype);
    Logger.prototype.defineProperty = function(target, name, desc) {
      lastLogged = name; // log the update
      // super-send to perform update on wrapped target
      return DelegatingHandler.prototype.defineProperty.call(this, target, name, desc);
    };

    var p = DelegatingHandler.proxyFor.call(Logger,{
      foo: 42,
      bar: function(v) { this.foo = v; }
    });

    // triggers "defineProperty" trap, logs the update:
    Object.defineProperty(p, "foo", {value:43,configurable:true}); // updated: "foo"
    
    assert(lastLogged === "foo", "DelegatingHandler defineProperty logged");
    lastLogged = "";
    
    // triggers the "set" trap, which in turn calls "defineProperty",
    // so this update is logged as well:
    p.foo = 44; // updated: "foo"
    assert(lastLogged === "foo", "DelegatingHandler set logged");
    lastLogged = "";
    
    // DelegatingHandler binds |this| inside the bar() method to p,
    // so the property update inside that method is logged as well:
    p.bar(); // updated: "foo"
    
    assert(lastLogged === "foo", "DelegatingHandler bar logged");
    lastLogged = "";
  }());
  


  // test ForwardingHandler using simple Logger example
  (function () {    
    var lastLogged = "";
    
    function Logger() {};
    Logger.prototype = Object.create(ForwardingHandler.prototype);
    Logger.prototype.defineProperty = function(target, name, desc) {
      lastLogged = name; // log the update
      // super-send to perform update on wrapped target
      return ForwardingHandler.prototype.defineProperty.call(this, target, name, desc);
    };

    var p = DelegatingHandler.proxyFor.call(Logger, {
      foo: 42,
      // (note: updated unit test to use accessor because we cannot support invoke() yet)
      set bar(v) { this.foo = v; }
    });

    // triggers "defineProperty" trap, logs the update:
    Object.defineProperty(p, "foo", {value:43, configurable:true}); // updated: "foo"
    
    assert(lastLogged === "foo", "ForwardingHandler defineProperty logged");
    lastLogged = "";
    
    // triggers the "set" trap, which in turn calls "defineProperty",
    // so this update is logged as well:
    p.foo = 44; // updated: "foo"
    
    assert(lastLogged === "foo", "ForwardingHandler set logged");
    lastLogged = "";
    
    // DelegatingHandler binds |this| inside the bar() accessor to target,
    // so the property update inside that accessor is not logged:
    // (note: updated unit test to use accessor because we cannot support invoke() yet)
    p.bar = 45;
    
    assert(lastLogged === "", "ForwardingHandler bar not logged");
  }());


  // assert ForwardingHandler is necessary to wrap objects with private state,
  // such as Date
  (function() {
    "use strict";    
    var target = new Date();
    var proxy = new Proxy(target, {}); // or new Proxy(target,new DelegatingHandler())
    
    assertThrows(/(^.*called on incompatible.*$)|(^.*not a Date.*$)/,
                 function() { proxy.getFullYear(); }); // error: not a Date
  }());
  
  (function() {
    "use strict";    
    var target = new Date();
    var proxy = new Proxy(target, new ForwardingHandler());
    // FIXME: does not currently work because of the lack of an invoke() trap!
    // assert(proxy.getFullYear() === target.getFullYear(),
    //     "proxy.getFullYear() works with ForwardingHandler");
    // turning it into an accessor works:
    Object.defineProperty(target,"fullYear",{
      // inside getter, this will refer to a proper Date
      get: function() { return Date.prototype.getFullYear.call(this); }
    });
    assert(proxy.fullYear === target.getFullYear(),
          "proxy.getFullYear() works with ForwardingHandler");

    var getFullYear = proxy.getFullYear;
    assertThrows(/(^.*can't convert.*$)|(^.*called on incompatible.*$)|(^.*not a Date.*$)/,
                 function() { getFullYear(); }); // error: not a Date
  }());


  // LazyObject with DelegatingHandler
  (function() {  
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

    // thunk will be called to initialize the object the first
    // time it is accessed:
    var thunk = function() { return {foo:42}; };

    // create a LazyObject proxy with the thunk, and an empty target object
    // (the target object is irrelevant for this abstraction):
    var dummyTarget = {};
    var p = DelegatingHandler.proxyFor.call(LazyObject, dummyTarget, thunk);

    assert(p.foo === 42, "p.foo === 42 for LazyObject");

    p.foo = 43;
    assert(p.foo === 42, "p.foo still 42 after update for LazyObject");
    assert(dummyTarget.foo === 43, "dummyTarget.foo === 43");
  }());


  // incomplete LazyObject with VirtualHandler
  (function() {    
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
      this.force(); // ensure the object is initialized
      // forward the operation not to the dummy target, but to the
      // initialized object stored in this.val:
      return Reflect.getOwnPropertyDescriptor(this.val, name);
    };

    // thunk will be called to initialize the object the first
    // time it is accessed:
    var thunk = function() { return {foo:42}; };

    // create a LazyObject proxy with the thunk, and an empty target object
    // (the target object is irrelevant for this abstraction):
    var dummyTarget = {};
    var p = DelegatingHandler.proxyFor.call(LazyObject, dummyTarget, thunk);

    assert(p.foo === 42, "p.foo === 42 for LazyObject");

    assertThrows("getPrototypeOf not implemented",
                 function() { p.foo = 43; });
  }());

  // complete LazyObject with VirtualHandler
  (function() {  
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

    // thunk will be called to initialize the object the first
    // time it is accessed:
    var thunk = function() { return {foo:42}; };

    // create a LazyObject proxy with the thunk, and an empty target object
    // (the target object is irrelevant for this abstraction):
    var dummyTarget = {};
    var p = DelegatingHandler.proxyFor.call(LazyObject, dummyTarget, thunk);

    assert(p.foo === 42, "p.foo === 42 for LazyObject");
    p.foo = 43;
    assert(p.foo === 43, "p.foo === 43 after update for LazyObject");
  }());

} // end test()

if (typeof window === "undefined") {
  test();
}