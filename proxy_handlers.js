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

/**
 * This file implements the Proxy Handler API as specified here:
 *
 *  http://wiki.ecmascript.org/doku.php?id=harmony:virtual_object_api
 *
 * Dependencies:
 *  - direct proxies, i.e. an ECMAScript 6 compatible Proxy API
 *  - Reflect, i.e. the ECMAScript 6 reflection module
 *
 * If these are not yet available, you can use the harmony-reflect shim:
 *   https://github.com/tvcutsem/harmony-reflect
 *
 * Exports:
 *  - DelegatingHandler
 *  - ForwardingHandler
 *  - VirtualHandler
 */
(function(exports) { // function-as-module pattern
  "use strict";

if (typeof Proxy === "undefined") {
  throw new Error("require ECMAScript 6 Proxy constructor");
}
if (typeof Reflect === "undefined") {
  throw new Error("require ECMAScript 6 Reflect module");
}

// == auxiliaries ==

// ---- Normalization functions for property descriptors ----
// (copied from reflect.js)

function isStandardAttribute(name) {
  return /^(get|set|value|writable|enumerable|configurable)$/.test(name);
}

// Adapted from ES5 section 8.10.5
function toPropertyDescriptor(obj) {
  if (Object(obj) !== obj) {
    throw new TypeError("property descriptor should be an Object, given: "+
                        obj);
  }
  var desc = {};
  if ('enumerable' in obj) { desc.enumerable = !!obj.enumerable; }
  if ('configurable' in obj) { desc.configurable = !!obj.configurable; }
  if ('value' in obj) { desc.value = obj.value; }
  if ('writable' in obj) { desc.writable = !!obj.writable; }
  if ('get' in obj) {
    var getter = obj.get;
    if (getter !== undefined && typeof getter !== "function") {
      throw new TypeError("property descriptor 'get' attribute must be "+
                          "callable or undefined, given: "+getter);
    }
    desc.get = getter;
  }
  if ('set' in obj) {
    var setter = obj.set;
    if (setter !== undefined && typeof setter !== "function") {
      throw new TypeError("property descriptor 'set' attribute must be "+
                          "callable or undefined, given: "+setter);
    }
    desc.set = setter;
  }
  if ('get' in desc || 'set' in desc) {
    if ('value' in desc || 'writable' in desc) {
      throw new TypeError("property descriptor cannot be both a data and an "+
                          "accessor descriptor: "+obj);
    }
  }
  return desc;
}

function isAccessorDescriptor(desc) {
  if (desc === undefined) return false;
  return ('get' in desc || 'set' in desc);
}
function isDataDescriptor(desc) {
  if (desc === undefined) return false;
  return ('value' in desc || 'writable' in desc);
}
function isGenericDescriptor(desc) {
  if (desc === undefined) return false;
  return !isAccessorDescriptor(desc) && !isDataDescriptor(desc);
}

function toCompletePropertyDescriptor(desc) {
  var internalDesc = toPropertyDescriptor(desc);
  if (isGenericDescriptor(internalDesc) || isDataDescriptor(internalDesc)) {
    if (!('value' in internalDesc)) { internalDesc.value = undefined; }
    if (!('writable' in internalDesc)) { internalDesc.writable = false; }
  } else {
    if (!('get' in internalDesc)) { internalDesc.get = undefined; }
    if (!('set' in internalDesc)) { internalDesc.set = undefined; }
  }
  if (!('enumerable' in internalDesc)) { internalDesc.enumerable = false; }
  if (!('configurable' in internalDesc)) { internalDesc.configurable = false; }
  return internalDesc;
}

/**
 * Returns a fresh property descriptor that is guaranteed
 * to be complete (i.e. contain all the standard attributes).
 * Additionally, any non-standard enumerable properties of
 * attributes are copied over to the fresh descriptor.
 *
 * If attributes is undefined, returns undefined.
 *
 * See also: http://wiki.ecmascript.org/doku.php?id=harmony:proxies_semantics
 */
function normalizeAndCompletePropertyDescriptor(attributes) {
  if (attributes === undefined) { return undefined; }
  var desc = toCompletePropertyDescriptor(attributes);
  // Note: no need to call FromPropertyDescriptor(desc), as we represent
  // "internal" property descriptors as proper Objects from the start
  for (var name in attributes) {
    if (!isStandardAttribute(name)) {
      Object.defineProperty(desc, name,
        { value: attributes[name],
          writable: true,
          enumerable: true,
          configurable: true });
    }
  }
  return desc;
}

// == handler definitions ==

// === DelegatingHandler ===

function forward(name) {
  return function(/*...args*/) {
    var args = Array.prototype.slice.call(arguments);
    return Reflect[name].apply(undefined, args);
  };
}

function DelegatingHandler() { };
DelegatingHandler.proxyFor = function(target /*,...args*/) {
  var args = Array.prototype.slice.call(arguments, 1);
  return new Proxy(target, Reflect.construct(this, args));
};
DelegatingHandler.revocableProxyFor = function(target /*,...args*/) {
  var args = Array.prototype.slice.call(arguments, 1);
  return Proxy.revocable(target, Reflect.construct(this, args));
};
 
DelegatingHandler.prototype = {
  // fundamental traps
  getOwnPropertyDescriptor: forward("getOwnPropertyDescriptor"),
  getOwnPropertyNames:      forward("getOwnPropertyNames"),
  getOwnPropertyKeys:       forward("getOwnPropertyKeys"),
  getPrototypeOf:           forward("getPrototypeOf"),
  setPrototypeOf:           forward("setPrototypeOf"),
  defineProperty:           forward("defineProperty"),
  deleteProperty:           forward("deleteProperty"),
  preventExtensions:        forward("preventExtensions"),
  apply:                    forward("apply"),
 
  // derived traps
  has: function(target, name) {
    var desc = this.getOwnPropertyDescriptor(target, name);
    desc = normalizeAndCompletePropertyDescriptor(desc);
    if (desc !== undefined) {
      return true;
    }
    var proto = this.getPrototypeOf(target);
    if (proto === null) {
      return false;
    }
    return Reflect.has(proto, name);
  },
  hasOwn: function(target,name) {
    var desc = this.getOwnPropertyDescriptor(target,name);
    desc = normalizeAndCompletePropertyDescriptor(desc);
    return desc !== undefined;
  },
  get: function(target, name, receiver) {
    var desc = this.getOwnPropertyDescriptor(target, name);
    desc = normalizeAndCompletePropertyDescriptor(desc);
    if (desc === undefined) {
      var proto = this.getPrototypeOf(target);
      if (proto === null) {
        return undefined;
      }
      return Reflect.get(proto, name, receiver);
    }
    if (isDataDescriptor(desc)) {
      return desc.value;
    }
    var getter = desc.get;
    if (getter === undefined) {
      return undefined;
    }
    return desc.get.call(receiver);
  },
  set: function(target, name, value, receiver) {
    var ownDesc = this.getOwnPropertyDescriptor(target, name);
    ownDesc = normalizeAndCompletePropertyDescriptor(ownDesc);
    if (isDataDescriptor(ownDesc)) {
      if (!ownDesc.writable) return false;
    }
    if (isAccessorDescriptor(ownDesc)) {
      if(ownDesc.set === undefined) return false;
      ownDesc.set.call(receiver, value);
      return true;
    }
    var proto = this.getPrototypeOf(target);
    if (proto === null) {
      var receiverDesc = Object.getOwnPropertyDescriptor(receiver, name);
      if (isAccessorDescriptor(receiverDesc)) {
        if(receiverDesc.set === undefined) return false;
        receiverDesc.set.call(receiver, value);
        return true;
      }
      if (isDataDescriptor(receiverDesc)) {
        if (!receiverDesc.writable) return false;
        Object.defineProperty(receiver, name, {value: value});
        return true;
      }
      if (!Object.isExtensible(receiver)) return false;
      Object.defineProperty(receiver, name,
        { value: value,
          writable: true,
          enumerable: true,
          configurable: true });
      return true;
    } else {
      return Reflect.set(proto, name, value, receiver);
    }
  },
  enumerate: function (target) {
    var result = [];
    
    var trapResult = this.getOwnPropertyNames(target);
    var l = +trapResult.length;
    var result = [];
    for (var i = 0; i < l; i++) {
      var name = String(trapResult[i]);
      var desc = this.getOwnPropertyDescriptor(name);
      desc = normalizeAndCompletePropertyDescriptor(desc);
      if (desc !== undefined && desc.enumerable) {
        result.push(name);
      }
    }
    var proto = this.getPrototypeOf(target);
    if (proto === null) {
      return result;
    }
    var parentResult = Reflect.enumerate(proto);
    // TODO: filter out duplicates
    result.concat(parentResult);
    return result;
  },
  keys: function(target) {
    var trapResult = this.getOwnPropertyNames(target);
    var l = +trapResult.length;
    var result = [];
    for (var i = 0; i < l; i++) {
      var name = String(trapResult[i]);
      var desc = this.getOwnPropertyDescriptor(name);
      desc = normalizeAndCompletePropertyDescriptor(desc);
      if (desc !== undefined && desc.enumerable) {
        result.push(name);
      }
    }
    return result;
  },
  construct: function(target, args) {
    var proto = this.get(target, 'prototype', target);
    var instance;
    if (Object(proto) === proto) {
      instance = Object.create(proto);        
    } else {
      instance = {};
    }
    var res = this.apply(target, instance, args);
    if (Object(res) === res) {
      return res;
    }
    return instance;
  },
 
  // deprecated traps:
 
  seal: function(target) {
    var success = this.preventExtensions(target);
    success = !!success; // coerce to Boolean
    if (success) {
      var props = this.getOwnPropertyNames(target);
      var l = +props.length;
      for (var i = 0; i < l; i++) {
        var name = props[i];
        success = success && this.defineProperty(target,name,{configurable:false});
      }
    }
    return success;
  },
  freeze: function(target) {
    var success = this.preventExtensions(target);
    success = !!success; // coerce to Boolean
    if (success) {
      var props = this.getOwnPropertyNames(target);
      var l = +props.length;
      for (var i = 0; i < l; i++) {
        var name = props[i];
        var desc = this.getOwnPropertyDescriptor(target,name);
        desc = normalizeAndCompletePropertyDescriptor(desc);
        if (IsAccessorDescriptor(desc)) {
          success = success &&
            this.defineProperty(target,name,{writable:false,configurable:false});
        } else if (desc !== undefined) {
          success = success &&
            this.defineProperty(target,name,{configurable:false});
        }
      }
    }
    return success;
  },
  isSealed: function(target) {
    if (this.isExtensible(target)) {
      return false;
    }
    var props = this.getOwnPropertyNames(target);
    return props.every(function(name) {
      return !this.getOwnPropertyDescriptor(target,name).configurable;
    }, this);
  },
  isFrozen: function(target) {
    if (this.isExtensible(target)) {
      return false;
    }
    var props = this.getOwnPropertyNames(target);
    return props.every(function(name) {
      var desc = this.getOwnPropertyDescriptor(target,name);
      return !desc.configurable && ("writable" in desc ? !desc.writable : true);
    }, this);
  },
};

// === ForwardingHandler ===

function ForwardingHandler() {
  DelegatingHandler.call(this); // not strictly necessary
}
ForwardingHandler.prototype = Object.create(DelegatingHandler.prototype);
ForwardingHandler.prototype.get = function(target, name, receiver) {
  var desc = this.getOwnPropertyDescriptor(target, name);
  desc = normalizeAndCompletePropertyDescriptor(desc);
  if (desc === undefined) {
    var proto = this.getPrototypeOf(target);
    if (proto === null) {
      return undefined;
    }
    return Reflect.get(proto, name, receiver);
  }
  if (isDataDescriptor(desc)) {
    return desc.value;
  }
  var getter = desc.get;
  if (getter === undefined) {
    return undefined;
  }
  return desc.get.call(target);
};
ForwardingHandler.prototype.set = function(target, name, value, receiver) {
  var ownDesc = this.getOwnPropertyDescriptor(target, name);
  ownDesc = normalizeAndCompletePropertyDescriptor(ownDesc);
  if (isDataDescriptor(ownDesc)) {
    if (!ownDesc.writable) return false;
  }
  if (isAccessorDescriptor(ownDesc)) {
    if(ownDesc.set === undefined) return false;
    ownDesc.set.call(target, value);
    return true;
  }
  var proto = this.getPrototypeOf(target);
  if (proto === null) {
    var receiverDesc = Object.getOwnPropertyDescriptor(receiver, name);
    if (isAccessorDescriptor(receiverDesc)) {
      if(receiverDesc.set === undefined) return false;
      receiverDesc.set.call(target, value);
      return true;
    }
    if (isDataDescriptor(receiverDesc)) {
      if (!receiverDesc.writable) return false;
      Object.defineProperty(receiver, name, {value: value});
      return true;
    }
    if (!Object.isExtensible(receiver)) return false;
    Object.defineProperty(receiver, name,
      { value: value,
        writable: true,
        enumerable: true,
        configurable: true });
    return true;
  } else {
    return Reflect.set(proto, name, value, receiver);
  }
};

// === VirtualHandler ===

function abstract(name) {
  return function(/*...args*/) {
    throw new TypeError(name + " not implemented");
  };
}
function VirtualHandler() {
  DelegatingHandler.call(this); // not strictly necessary
}
VirtualHandler.prototype = Object.create(DelegatingHandler.prototype);
VirtualHandler.prototype.getOwnPropertyDescriptor = abstract("getOwnPropertyDescriptor");
VirtualHandler.prototype.getOwnPropertyNames      = abstract("getOwnPropertyNames");
VirtualHandler.prototype.getOwnPropertyKeys       = abstract("getOwnPropertyKeys");
VirtualHandler.prototype.getPrototypeOf           = abstract("getPrototypeOf");
VirtualHandler.prototype.setPrototypeOf           = abstract("setPrototypeOf");
VirtualHandler.prototype.defineProperty           = abstract("defineProperty");
VirtualHandler.prototype.deleteProperty           = abstract("deleteProperty");
VirtualHandler.prototype.preventExtensions        = abstract("preventExtensions");
VirtualHandler.prototype.apply                    = abstract("apply");

// == export bindings ==

exports.DelegatingHandler = DelegatingHandler;
exports.ForwardingHandler = ForwardingHandler;
exports.VirtualHandler = VirtualHandler;

}(typeof exports !== 'undefined' ? exports : this)); // function-as-module pattern