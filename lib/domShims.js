// Browser-side shims bundled first into the old-TV build (see legacyBuild.js).
// core-js covers the language; these cover DOM methods it does not:
// append/prepend (Chrome 54), replaceChildren (86), matches/closest (41),
// MediaQueryList.addEventListener (45). Plain ES5, no-ops on current browsers.
(function () {
  function toNode(args) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < args.length; i++) {
      var n = args[i];
      frag.appendChild(n instanceof Node ? n : document.createTextNode(String(n)));
    }
    return frag;
  }
  function define(proto, name, fn) {
    if (proto && !proto[name]) Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true });
  }
  [Element.prototype, Document.prototype, DocumentFragment.prototype].forEach(function (p) {
    define(p, 'append', function () { this.appendChild(toNode(arguments)); });
    define(p, 'prepend', function () { this.insertBefore(toNode(arguments), this.firstChild); });
    define(p, 'replaceChildren', function () {
      var frag = toNode(arguments);
      while (this.lastChild) this.removeChild(this.lastChild);
      this.appendChild(frag);
    });
  });
  var E = Element.prototype;
  define(E, 'matches', E.webkitMatchesSelector || E.msMatchesSelector);
  define(E, 'closest', function (sel) {
    for (var el = this; el && el.nodeType === 1; el = el.parentNode) if (el.matches(sel)) return el;
    return null;
  });
  define(E, 'remove', function () { if (this.parentNode) this.parentNode.removeChild(this); });
  if (window.MediaQueryList && !MediaQueryList.prototype.addEventListener) {
    define(MediaQueryList.prototype, 'addEventListener', function (type, fn) { if (type === 'change') this.addListener(fn); });
    define(MediaQueryList.prototype, 'removeEventListener', function (type, fn) { if (type === 'change') this.removeListener(fn); });
  }
})();
