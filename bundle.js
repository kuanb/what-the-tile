(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
module.exports = {
  'country.3148': {
    'name': 'France',
    'bbox': [[-4.59235, 41.380007], [9.560016, 51.148506]]
  },
  'country.3145': {
    'name': 'United States',
    'bbox': [[-171.791111, 18.91619], [-66.96466, 71.357764]]
  },
  'country.330': {
    'name': 'Russia',
    'bbox': [[19.66064, 41.151416], [190.10042, 81.2504]]
  },
  'country.3179': {
    'name': 'Canada',
    'bbox': [[-140.99778, 41.675105], [-52.648099, 83.23324]]
  }
};

},{}],2:[function(require,module,exports){
'use strict';

var Typeahead = require('suggestions');
var debounce = require('lodash.debounce');
var extend = require('xtend');
var EventEmitter = require('events').EventEmitter;
var exceptions = require('./exceptions');
var MapboxClient = require('mapbox/lib/services/geocoding');

/**
 * A geocoder component using Mapbox Geocoding API
 * @class MapboxGeocoder
 *
 * @param {Object} options
 * @param {String} options.accessToken Required.
 * @param {Number} [options.zoom=16] On geocoded result what zoom level should the map animate to when a `bbox` isn't found in the response. If a `bbox` is found the map will fit to the `bbox`.
 * @param {Boolean} [options.flyTo=true] If false, animating the map to a selected result is disabled.
 * @param {String} [options.placeholder="Search"] Override the default placeholder attribute value.
 * @param {Object} [options.proximity] a proximity argument: this is
 * a geographical point given as an object with latitude and longitude
 * properties. Search results closer to this point will be given
 * higher priority.
 * @param {Boolean} [options.trackProximity=false] If true, the geocoder proximity will automatically update based on the map view.
 * @param {Array} [options.bbox] a bounding box argument: this is
 * a bounding box given as an array in the format [minX, minY, maxX, maxY].
 * Search results will be limited to the bounding box.
 * @param {string} [options.types] a comma seperated list of types that filter
 * results to match those specified. See https://www.mapbox.com/developers/api/geocoding/#filter-type
 * for available types.
 * @param {string} [options.country] a comma separated list of country codes to
 * limit results to specified country or countries.
 * @param {Number} [options.minLength=2] Minimum number of characters to enter before results are shown.
 * @param {Number} [options.limit=5] Maximum number of results to show.
 * @param {string} [options.language] Specify the language to use for response text and query result weighting. Options are IETF language tags comprised of a mandatory ISO 639-1 language code and optionally one or more IETF subtags for country or script. More than one value can also be specified, separated by commas.
 * @param {Function} [options.filter] A function which accepts a Feature in the [Carmen GeoJSON](https://github.com/mapbox/carmen/blob/master/carmen-geojson.md) format to filter out results from the Geocoding API response before they are included in the suggestions list. Return `true` to keep the item, `false` otherwise.
 * @param {Function} [options.localGeocoder] A function accepting the query string which performs local geocoding to supplement results from the Mapbox Geocoding API. Expected to return an Array of GeoJSON Features in the [Carmen GeoJSON](https://github.com/mapbox/carmen/blob/master/carmen-geojson.md) format.
 * @example
 * var geocoder = new MapboxGeocoder({ accessToken: mapboxgl.accessToken });
 * map.addControl(geocoder);
 * @return {MapboxGeocoder} `this`
 */
function MapboxGeocoder(options) {
  this._eventEmitter = new EventEmitter();
  this.options = extend({}, this.options, options);
}

MapboxGeocoder.prototype = {

  options: {
    placeholder: 'Search',
    zoom: 16,
    flyTo: true,
    trackProximity: false,
    minLength: 2,
    limit: 5
  },

  onAdd: function(map) {
    this._map = map;
    this.mapboxClient = new MapboxClient(this.options.accessToken);
    this._onChange = this._onChange.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onQueryResult = this._onQueryResult.bind(this);
    this._clear = this._clear.bind(this);
    this._updateProximity = this._updateProximity.bind(this);

    var el = this.container = document.createElement('div');
    el.className = 'mapboxgl-ctrl-geocoder mapboxgl-ctrl';

    var icon = document.createElement('span');
    icon.className = 'geocoder-icon geocoder-icon-search';

    this._inputEl = document.createElement('input');
    this._inputEl.type = 'text';
    this._inputEl.placeholder = this.options.placeholder;

    this._inputEl.addEventListener('keydown', this._onKeyDown);
    this._inputEl.addEventListener('change', this._onChange);

    var actions = document.createElement('div');
    actions.classList.add('geocoder-pin-right');

    this._clearEl = document.createElement('button');
    this._clearEl.className = 'geocoder-icon geocoder-icon-close';
    this._clearEl.setAttribute('aria-label', 'Clear');
    this._clearEl.addEventListener('click', this._clear);

    this._loadingEl = document.createElement('span');
    this._loadingEl.className = 'geocoder-icon geocoder-icon-loading';

    actions.appendChild(this._clearEl);
    actions.appendChild(this._loadingEl);

    el.appendChild(icon);
    el.appendChild(this._inputEl);
    el.appendChild(actions);

    this._typeahead = new Typeahead(this._inputEl, [], {
      filter: false,
      minLength: this.options.minLength,
      limit: this.options.limit
    });
    this._typeahead.getItemValue = function(item) { return item.place_name; };

    if (this.options.trackProximity) {
      this._updateProximity();
      this._map.on('moveend', this._updateProximity);
    }

    return el;
  },

  onRemove: function() {
    this.container.parentNode.removeChild(this.container);
    this._map = null;

    if (this.options.trackProximity) {
      this._map.off('moveend', this._updateProximity);
    }

    return this;
  },

  _onKeyDown: debounce(function(e) {
    // if target has shadowRoot, then get the actual active element inside the shadowRoot
    var target = e.target.shadowRoot ? e.target.shadowRoot.activeElement : e.target;
    if (!target.value) {
      return this._clearEl.style.display = 'none';
    }

    // TAB, ESC, LEFT, RIGHT, ENTER, UP, DOWN
    if (e.metaKey || [9, 27, 37, 39, 13, 38, 40].indexOf(e.keyCode) !== -1) return;

    if (target.value.length >= this.options.minLength) {
      this._geocode(target.value);
    }
  }, 200),

  _onChange: function() {
    if (this._inputEl.value) this._clearEl.style.display = 'block';
    var selected = this._typeahead.selected;
    if (selected) {
      if (this.options.flyTo) {
        if (!exceptions[selected.id] && selected.bbox) {
          var bbox = selected.bbox;
          this._map.fitBounds([[bbox[0], bbox[1]],[bbox[2], bbox[3]]]);
        } else if (exceptions[selected.id]) {
          // Certain geocoder search results return (and therefore zoom to fit)
          // an unexpectedly large bounding box: for example, both Russia and the
          // USA span both sides of -180/180, or France includes the island of
          // Reunion in the Indian Ocean. An incomplete list of these exceptions
          // at ./exceptions.json provides "reasonable" bounding boxes as a
          // short-term solution; this may be amended as necessary.
          this._map.fitBounds(exceptions[selected.id].bbox);
        } else {
          this._map.flyTo({
            center: selected.center,
            zoom: this.options.zoom
          });
        }
      }
      this._eventEmitter.emit('result', { result: selected });
    }
  },

  _geocode: function(searchInput) {
    this._loadingEl.style.display = 'block';
    this._eventEmitter.emit('loading', { query: searchInput });
    var request = this.mapboxClient.geocodeForward(searchInput, this.options);

    var localGeocoderRes = [];
    if (this.options.localGeocoder) {
      localGeocoderRes = this.options.localGeocoder(searchInput);
      if (!localGeocoderRes) {
        localGeocoderRes = [];
      }
    }

    request.then(function (response) {
      this._loadingEl.style.display = 'none';

      var res = {};

      if (response.status == '200') {
        res = response.entity;
      }

      // supplement Mapbox Geocoding API results with locally populated results
      res.features = res.features ? localGeocoderRes.concat(res.features) : localGeocoderRes;

      // apply results filter if provided
      if (this.options.filter && res.features.length) {
        res.features = res.features.filter(this.options.filter);
      }

      if (res.features.length) {
        this._clearEl.style.display = 'block';
      } else {
        this._clearEl.style.display = 'none';
        this._typeahead.selected = null;
      }

      this._eventEmitter.emit('results', res);
      this._typeahead.update(res.features);
    }.bind(this));

    request.catch(function (err) {
      this._loadingEl.style.display = 'none';

      // in the event of an error in the Mapbox Geocoding API still display results from the localGeocoder
      if (localGeocoderRes.length) {
        this._clearEl.style.display = 'block';
      } else {
        this._clearEl.style.display = 'none';
        this._typeahead.selected = null;
      }

      this._eventEmitter.emit('results', { features: localGeocoderRes });
      this._typeahead.update(localGeocoderRes);

      this._eventEmitter.emit('error', { error: err });
    }.bind(this));

    return request;
  },

  _clear: function(ev) {
    if (ev) ev.preventDefault();
    this._inputEl.value = '';
    this._typeahead.selected = null;
    this._typeahead.clear();
    this._onChange();
    this._inputEl.focus();
    this._clearEl.style.display = 'none';
    this._eventEmitter.emit('clear');
  },

  _onQueryResult: function(response) {
    var results = response.entity;
    if (!results.features.length) return;
    var result = results.features[0];
    this._typeahead.selected = result;
    this._inputEl.value = result.place_name;
    this._onChange();
  },

  _updateProximity: function() {
    // proximity is designed for local scale, if the user is looking at the whole world,
    // it doesn't make sense to factor in the arbitrary centre of the map
    if (this._map.getZoom() > 9) {
      var center = this._map.getCenter().wrap();
      this.setProximity({ longitude: center.lng, latitude: center.lat });
    } else {
      this.setProximity(null);
    }
  },

  /**
   * Set & query the input
   * @param {string} searchInput location name or other search input
   * @returns {MapboxGeocoder} this
   */
  query: function(searchInput) {
    this._geocode(searchInput).then(this._onQueryResult);
    return this;
  },

  /**
   * Set input
   * @param {string} searchInput location name or other search input
   * @returns {MapboxGeocoder} this
   */
  setInput: function(searchInput) {
    // Set input value to passed value and clear everything else.
    this._inputEl.value = searchInput;
    this._typeahead.selected = null;
    this._typeahead.clear();
    this._onChange();
    return this;
  },

  /**
   * Set proximity
   * @param {Object} proximity The new options.proximity value. This is a geographical point given as an object with latitude and longitude properties.
   * @returns {MapboxGeocoder} this
   */
  setProximity: function(proximity) {
    this.options.proximity = proximity;
    return this;
  },

  /**
   * Get proximity
   * @returns {Object} The geocoder proximity
   */
  getProximity: function() {
    return this.options.proximity;
  },

  /**
   * Subscribe to events that happen within the plugin.
   * @param {String} type name of event. Available events and the data passed into their respective event objects are:
   *
   * - __clear__ `Emitted when the input is cleared`
   * - __loading__ `{ query } Emitted when the geocoder is looking up a query`
   * - __results__ `{ results } Fired when the geocoder returns a response`
   * - __result__ `{ result } Fired when input is set`
   * - __error__ `{ error } Error as string`
   * @param {Function} fn function that's called when the event is emitted.
   * @returns {MapboxGeocoder} this;
   */
  on: function(type, fn) {
    this._eventEmitter.on(type, fn);
    return this;
  },

  /**
   * Remove an event
   * @returns {MapboxGeocoder} this
   * @param {String} type Event name.
   * @param {Function} fn Function that should unsubscribe to the event emitted.
   */
  off: function(type, fn) {
    this._eventEmitter.removeListener(type, fn);
    return this;
  }
};

module.exports = MapboxGeocoder;

},{"./exceptions":1,"events":6,"lodash.debounce":8,"mapbox/lib/services/geocoding":17,"suggestions":53,"xtend":58}],3:[function(require,module,exports){
'use strict';

var tilebelt = require('@mapbox/tilebelt');

/**
 * Given a geometry, create cells and return them in a format easily readable
 * by any software that reads GeoJSON.
 *
 * @alias geojson
 * @param {Object} geom GeoJSON geometry
 * @param {Object} limits an object with min_zoom and max_zoom properties
 * specifying the minimum and maximum level to be tiled.
 * @returns {Object} FeatureCollection of cells formatted as GeoJSON Features
 */
exports.geojson = function (geom, limits) {
    return {
        type: 'FeatureCollection',
        features: getTiles(geom, limits).map(tileToFeature)
    };
};

function tileToFeature(t) {
    return {
        type: 'Feature',
        geometry: tilebelt.tileToGeoJSON(t),
        properties: {}
    };
}

/**
 * Given a geometry, create cells and return them in their raw form,
 * as an array of cell identifiers.
 *
 * @alias tiles
 * @param {Object} geom GeoJSON geometry
 * @param {Object} limits an object with min_zoom and max_zoom properties
 * specifying the minimum and maximum level to be tiled.
 * @returns {Array<Array<number>>} An array of tiles given as [x, y, z] arrays
 */
exports.tiles = getTiles;

/**
 * Given a geometry, create cells and return them as
 * [quadkey](http://msdn.microsoft.com/en-us/library/bb259689.aspx) indexes.
 *
 * @alias indexes
 * @param {Object} geom GeoJSON geometry
 * @param {Object} limits an object with min_zoom and max_zoom properties
 * specifying the minimum and maximum level to be tiled.
 * @returns {Array<String>} An array of tiles given as quadkeys.
 */
exports.indexes = function (geom, limits) {
    return getTiles(geom, limits).map(tilebelt.tileToQuadkey);
};

function getTiles(geom, limits) {
    var i, tile,
        coords = geom.coordinates,
        maxZoom = limits.max_zoom,
        tileHash = {},
        tiles = [];

    if (geom.type === 'Point') {
        return [tilebelt.pointToTile(coords[0], coords[1], maxZoom)];

    } else if (geom.type === 'MultiPoint') {
        for (i = 0; i < coords.length; i++) {
            tile = tilebelt.pointToTile(coords[i][0], coords[i][1], maxZoom);
            tileHash[toID(tile[0], tile[1], tile[2])] = true;
        }
    } else if (geom.type === 'LineString') {
        lineCover(tileHash, coords, maxZoom);

    } else if (geom.type === 'MultiLineString') {
        for (i = 0; i < coords.length; i++) {
            lineCover(tileHash, coords[i], maxZoom);
        }
    } else if (geom.type === 'Polygon') {
        polygonCover(tileHash, tiles, coords, maxZoom);

    } else if (geom.type === 'MultiPolygon') {
        for (i = 0; i < coords.length; i++) {
            polygonCover(tileHash, tiles, coords[i], maxZoom);
        }
    } else {
        throw new Error('Geometry type not implemented');
    }

    if (limits.min_zoom !== maxZoom) {
        // sync tile hash and tile array so that both contain the same tiles
        var len = tiles.length;
        appendHashTiles(tileHash, tiles);
        for (i = 0; i < len; i++) {
            var t = tiles[i];
            tileHash[toID(t[0], t[1], t[2])] = true;
        }
        return mergeTiles(tileHash, tiles, limits);
    }

    appendHashTiles(tileHash, tiles);
    return tiles;
}

function mergeTiles(tileHash, tiles, limits) {
    var mergedTiles = [];

    for (var z = limits.max_zoom; z > limits.min_zoom; z--) {

        var parentTileHash = {};
        var parentTiles = [];

        for (var i = 0; i < tiles.length; i++) {
            var t = tiles[i];

            if (t[0] % 2 === 0 && t[1] % 2 === 0) {
                var id2 = toID(t[0] + 1, t[1], z),
                    id3 = toID(t[0], t[1] + 1, z),
                    id4 = toID(t[0] + 1, t[1] + 1, z);

                if (tileHash[id2] && tileHash[id3] && tileHash[id4]) {
                    tileHash[toID(t[0], t[1], t[2])] = false;
                    tileHash[id2] = false;
                    tileHash[id3] = false;
                    tileHash[id4] = false;

                    var parentTile = [t[0] / 2, t[1] / 2, z - 1];

                    if (z - 1 === limits.min_zoom) mergedTiles.push(parentTile);
                    else {
                        parentTileHash[toID(t[0] / 2, t[1] / 2, z - 1)] = true;
                        parentTiles.push(parentTile);
                    }
                }
            }
        }

        for (i = 0; i < tiles.length; i++) {
            t = tiles[i];
            if (tileHash[toID(t[0], t[1], t[2])]) mergedTiles.push(t);
        }

        tileHash = parentTileHash;
        tiles = parentTiles;
    }

    return mergedTiles;
}

function polygonCover(tileHash, tileArray, geom, zoom) {
    var intersections = [];

    for (var i = 0; i < geom.length; i++) {
        var ring = [];
        lineCover(tileHash, geom[i], zoom, ring);

        for (var j = 0, len = ring.length, k = len - 1; j < len; k = j++) {
            var m = (j + 1) % len;
            var y = ring[j][1];

            // add interesction if it's not local extremum or duplicate
            if ((y > ring[k][1] || y > ring[m][1]) && // not local minimum
                (y < ring[k][1] || y < ring[m][1]) && // not local maximum
                y !== ring[m][1]) intersections.push(ring[j]);
        }
    }

    intersections.sort(compareTiles); // sort by y, then x

    for (i = 0; i < intersections.length; i += 2) {
        // fill tiles between pairs of intersections
        y = intersections[i][1];
        for (var x = intersections[i][0] + 1; x < intersections[i + 1][0]; x++) {
            var id = toID(x, y, zoom);
            if (!tileHash[id]) {
                tileArray.push([x, y, zoom]);
            }
        }
    }
}

function compareTiles(a, b) {
    return (a[1] - b[1]) || (a[0] - b[0]);
}

function lineCover(tileHash, coords, maxZoom, ring) {
    var prevX, prevY;

    for (var i = 0; i < coords.length - 1; i++) {
        var start = tilebelt.pointToTileFraction(coords[i][0], coords[i][1], maxZoom),
            stop = tilebelt.pointToTileFraction(coords[i + 1][0], coords[i + 1][1], maxZoom),
            x0 = start[0],
            y0 = start[1],
            x1 = stop[0],
            y1 = stop[1],
            dx = x1 - x0,
            dy = y1 - y0;

        if (dy === 0 && dx === 0) continue;

        var sx = dx > 0 ? 1 : -1,
            sy = dy > 0 ? 1 : -1,
            x = Math.floor(x0),
            y = Math.floor(y0),
            tMaxX = dx === 0 ? Infinity : Math.abs(((dx > 0 ? 1 : 0) + x - x0) / dx),
            tMaxY = dy === 0 ? Infinity : Math.abs(((dy > 0 ? 1 : 0) + y - y0) / dy),
            tdx = Math.abs(sx / dx),
            tdy = Math.abs(sy / dy);

        if (x !== prevX || y !== prevY) {
            tileHash[toID(x, y, maxZoom)] = true;
            if (ring && y !== prevY) ring.push([x, y]);
            prevX = x;
            prevY = y;
        }

        while (tMaxX < 1 || tMaxY < 1) {
            if (tMaxX < tMaxY) {
                tMaxX += tdx;
                x += sx;
            } else {
                tMaxY += tdy;
                y += sy;
            }
            tileHash[toID(x, y, maxZoom)] = true;
            if (ring && y !== prevY) ring.push([x, y]);
            prevX = x;
            prevY = y;
        }
    }

    if (ring && y === ring[0][1]) ring.pop();
}

function appendHashTiles(hash, tiles) {
    var keys = Object.keys(hash);
    for (var i = 0; i < keys.length; i++) {
        tiles.push(fromID(+keys[i]));
    }
}

function toID(x, y, z) {
    var dim = 2 * (1 << z);
    return ((dim * y + x) * 32) + z;
}

function fromID(id) {
    var z = id % 32,
        dim = 2 * (1 << z),
        xy = ((id - z) / 32),
        x = xy % dim,
        y = ((xy - x) / dim) % dim;
    return [x, y, z];
}

},{"@mapbox/tilebelt":4}],4:[function(require,module,exports){
'use strict';

var d2r = Math.PI / 180,
    r2d = 180 / Math.PI;

/**
 * Get the bbox of a tile
 *
 * @name tileToBBOX
 * @param {Array<number>} tile
 * @returns {Array<number>} bbox
 * @example
 * var bbox = tileToBBOX([5, 10, 10])
 * //=bbox
 */
function tileToBBOX(tile) {
    var e = tile2lon(tile[0] + 1, tile[2]);
    var w = tile2lon(tile[0], tile[2]);
    var s = tile2lat(tile[1] + 1, tile[2]);
    var n = tile2lat(tile[1], tile[2]);
    return [w, s, e, n];
}

/**
 * Get a geojson representation of a tile
 *
 * @name tileToGeoJSON
 * @param {Array<number>} tile
 * @returns {Feature<Polygon>}
 * @example
 * var poly = tileToGeoJSON([5, 10, 10])
 * //=poly
 */
function tileToGeoJSON(tile) {
    var bbox = tileToBBOX(tile);
    var poly = {
        type: 'Polygon',
        coordinates: [[
            [bbox[0], bbox[1]],
            [bbox[0], bbox[3]],
            [bbox[2], bbox[3]],
            [bbox[2], bbox[1]],
            [bbox[0], bbox[1]]
        ]]
    };
    return poly;
}

function tile2lon(x, z) {
    return x / Math.pow(2, z) * 360 - 180;
}

function tile2lat(y, z) {
    var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
    return r2d * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Get the tile for a point at a specified zoom level
 *
 * @name pointToTile
 * @param {number} lon
 * @param {number} lat
 * @param {number} z
 * @returns {Array<number>} tile
 * @example
 * var tile = pointToTile(1, 1, 20)
 * //=tile
 */
function pointToTile(lon, lat, z) {
    var tile = pointToTileFraction(lon, lat, z);
    tile[0] = Math.floor(tile[0]);
    tile[1] = Math.floor(tile[1]);
    return tile;
}

/**
 * Get the 4 tiles one zoom level higher
 *
 * @name getChildren
 * @param {Array<number>} tile
 * @returns {Array<Array<number>>} tiles
 * @example
 * var tiles = getChildren([5, 10, 10])
 * //=tiles
 */
function getChildren(tile) {
    return [
        [tile[0] * 2, tile[1] * 2, tile[2] + 1],
        [tile[0] * 2 + 1, tile[1] * 2, tile[2 ] + 1],
        [tile[0] * 2 + 1, tile[1] * 2 + 1, tile[2] + 1],
        [tile[0] * 2, tile[1] * 2 + 1, tile[2] + 1]
    ];
}

/**
 * Get the tile one zoom level lower
 *
 * @name getParent
 * @param {Array<number>} tile
 * @returns {Array<number>} tile
 * @example
 * var tile = getParent([5, 10, 10])
 * //=tile
 */
function getParent(tile) {
    // top left
    if (tile[0] % 2 === 0 && tile[1] % 2 === 0) {
        return [tile[0] / 2, tile[1] / 2, tile[2] - 1];
    }
    // bottom left
    if ((tile[0] % 2 === 0) && (!tile[1] % 2 === 0)) {
        return [tile[0] / 2, (tile[1] - 1) / 2, tile[2] - 1];
    }
    // top right
    if ((!tile[0] % 2 === 0) && (tile[1] % 2 === 0)) {
        return [(tile[0] - 1) / 2, (tile[1]) / 2, tile[2] - 1];
    }
    // bottom right
    return [(tile[0] - 1) / 2, (tile[1] - 1) / 2, tile[2] - 1];
}

function getSiblings(tile) {
    return getChildren(getParent(tile));
}

/**
 * Get the 3 sibling tiles for a tile
 *
 * @name getSiblings
 * @param {Array<number>} tile
 * @returns {Array<Array<number>>} tiles
 * @example
 * var tiles = getSiblings([5, 10, 10])
 * //=tiles
 */
function hasSiblings(tile, tiles) {
    var siblings = getSiblings(tile);
    for (var i = 0; i < siblings.length; i++) {
        if (!hasTile(tiles, siblings[i])) return false;
    }
    return true;
}

/**
 * Check to see if an array of tiles contains a particular tile
 *
 * @name hasTile
 * @param {Array<Array<number>>} tiles
 * @param {Array<number>} tile
 * @returns {boolean}
 * @example
 * var tiles = [
 *     [0, 0, 5],
 *     [0, 1, 5],
 *     [1, 1, 5],
 *     [1, 0, 5]
 * ]
 * hasTile(tiles, [0, 0, 5])
 * //=boolean
 */
function hasTile(tiles, tile) {
    for (var i = 0; i < tiles.length; i++) {
        if (tilesEqual(tiles[i], tile)) return true;
    }
    return false;
}

/**
 * Check to see if two tiles are the same
 *
 * @name tilesEqual
 * @param {Array<number>} tile1
 * @param {Array<number>} tile2
 * @returns {boolean}
 * @example
 * tilesEqual([0, 1, 5], [0, 0, 5])
 * //=boolean
 */
function tilesEqual(tile1, tile2) {
    return (
        tile1[0] === tile2[0] &&
        tile1[1] === tile2[1] &&
        tile1[2] === tile2[2]
    );
}

/**
 * Get the quadkey for a tile
 *
 * @name tileToQuadkey
 * @param {Array<number>} tile
 * @returns {string} quadkey
 * @example
 * var quadkey = tileToQuadkey([0, 1, 5])
 * //=quadkey
 */
function tileToQuadkey(tile) {
    var index = '';
    for (var z = tile[2]; z > 0; z--) {
        var b = 0;
        var mask = 1 << (z - 1);
        if ((tile[0] & mask) !== 0) b++;
        if ((tile[1] & mask) !== 0) b += 2;
        index += b.toString();
    }
    return index;
}

/**
 * Get the tile for a quadkey
 *
 * @name quadkeyToTile
 * @param {string} quadkey
 * @returns {Array<number>} tile
 * @example
 * var tile = quadkeyToTile('00001033')
 * //=tile
 */
function quadkeyToTile(quadkey) {
    var x = 0;
    var y = 0;
    var z = quadkey.length;

    for (var i = z; i > 0; i--) {
        var mask = 1 << (i - 1);
        var q = +quadkey[z - i];
        if (q === 1) x |= mask;
        if (q === 2) y |= mask;
        if (q === 3) {
            x |= mask;
            y |= mask;
        }
    }
    return [x, y, z];
}

/**
 * Get the smallest tile to cover a bbox
 *
 * @name bboxToTile
 * @param {Array<number>} bbox
 * @returns {Array<number>} tile
 * @example
 * var tile = bboxToTile([ -178, 84, -177, 85 ])
 * //=tile
 */
function bboxToTile(bboxCoords) {
    var min = pointToTile(bboxCoords[0], bboxCoords[1], 32);
    var max = pointToTile(bboxCoords[2], bboxCoords[3], 32);
    var bbox = [min[0], min[1], max[0], max[1]];

    var z = getBboxZoom(bbox);
    if (z === 0) return [0, 0, 0];
    var x = bbox[0] >>> (32 - z);
    var y = bbox[1] >>> (32 - z);
    return [x, y, z];
}

function getBboxZoom(bbox) {
    var MAX_ZOOM = 28;
    for (var z = 0; z < MAX_ZOOM; z++) {
        var mask = 1 << (32 - (z + 1));
        if (((bbox[0] & mask) !== (bbox[2] & mask)) ||
            ((bbox[1] & mask) !== (bbox[3] & mask))) {
            return z;
        }
    }

    return MAX_ZOOM;
}

/**
 * Get the precise fractional tile location for a point at a zoom level
 *
 * @name pointToTileFraction
 * @param {number} lon
 * @param {number} lat
 * @param {number} z
 * @returns {Array<number>} tile fraction
 * var tile = pointToTileFraction(30.5, 50.5, 15)
 * //=tile
 */
function pointToTileFraction(lon, lat, z) {
    var sin = Math.sin(lat * d2r),
        z2 = Math.pow(2, z),
        x = z2 * (lon / 360 + 0.5),
        y = z2 * (0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI);
    return [x, y, z];
}

module.exports = {
    tileToGeoJSON: tileToGeoJSON,
    tileToBBOX: tileToBBOX,
    getChildren: getChildren,
    getParent: getParent,
    getSiblings: getSiblings,
    hasTile: hasTile,
    hasSiblings: hasSiblings,
    tilesEqual: tilesEqual,
    tileToQuadkey: tileToQuadkey,
    quadkeyToTile: quadkeyToTile,
    pointToTile: pointToTile,
    bboxToTile: bboxToTile,
    pointToTileFraction: pointToTileFraction
};

},{}],5:[function(require,module,exports){
(function (process,global){
/*!
 * @overview es6-promise - a tiny implementation of Promises/A+.
 * @copyright Copyright (c) 2014 Yehuda Katz, Tom Dale, Stefan Penner and contributors (Conversion to ES6 API by Jake Archibald)
 * @license   Licensed under MIT license
 *            See https://raw.githubusercontent.com/stefanpenner/es6-promise/master/LICENSE
 * @version   v4.2.5+7f2b526d
 */

(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
	typeof define === 'function' && define.amd ? define(factory) :
	(global.ES6Promise = factory());
}(this, (function () { 'use strict';

function objectOrFunction(x) {
  var type = typeof x;
  return x !== null && (type === 'object' || type === 'function');
}

function isFunction(x) {
  return typeof x === 'function';
}



var _isArray = void 0;
if (Array.isArray) {
  _isArray = Array.isArray;
} else {
  _isArray = function (x) {
    return Object.prototype.toString.call(x) === '[object Array]';
  };
}

var isArray = _isArray;

var len = 0;
var vertxNext = void 0;
var customSchedulerFn = void 0;

var asap = function asap(callback, arg) {
  queue[len] = callback;
  queue[len + 1] = arg;
  len += 2;
  if (len === 2) {
    // If len is 2, that means that we need to schedule an async flush.
    // If additional callbacks are queued before the queue is flushed, they
    // will be processed by this flush that we are scheduling.
    if (customSchedulerFn) {
      customSchedulerFn(flush);
    } else {
      scheduleFlush();
    }
  }
};

function setScheduler(scheduleFn) {
  customSchedulerFn = scheduleFn;
}

function setAsap(asapFn) {
  asap = asapFn;
}

var browserWindow = typeof window !== 'undefined' ? window : undefined;
var browserGlobal = browserWindow || {};
var BrowserMutationObserver = browserGlobal.MutationObserver || browserGlobal.WebKitMutationObserver;
var isNode = typeof self === 'undefined' && typeof process !== 'undefined' && {}.toString.call(process) === '[object process]';

// test for web worker but not in IE10
var isWorker = typeof Uint8ClampedArray !== 'undefined' && typeof importScripts !== 'undefined' && typeof MessageChannel !== 'undefined';

// node
function useNextTick() {
  // node version 0.10.x displays a deprecation warning when nextTick is used recursively
  // see https://github.com/cujojs/when/issues/410 for details
  return function () {
    return process.nextTick(flush);
  };
}

// vertx
function useVertxTimer() {
  if (typeof vertxNext !== 'undefined') {
    return function () {
      vertxNext(flush);
    };
  }

  return useSetTimeout();
}

function useMutationObserver() {
  var iterations = 0;
  var observer = new BrowserMutationObserver(flush);
  var node = document.createTextNode('');
  observer.observe(node, { characterData: true });

  return function () {
    node.data = iterations = ++iterations % 2;
  };
}

// web worker
function useMessageChannel() {
  var channel = new MessageChannel();
  channel.port1.onmessage = flush;
  return function () {
    return channel.port2.postMessage(0);
  };
}

function useSetTimeout() {
  // Store setTimeout reference so es6-promise will be unaffected by
  // other code modifying setTimeout (like sinon.useFakeTimers())
  var globalSetTimeout = setTimeout;
  return function () {
    return globalSetTimeout(flush, 1);
  };
}

var queue = new Array(1000);
function flush() {
  for (var i = 0; i < len; i += 2) {
    var callback = queue[i];
    var arg = queue[i + 1];

    callback(arg);

    queue[i] = undefined;
    queue[i + 1] = undefined;
  }

  len = 0;
}

function attemptVertx() {
  try {
    var vertx = Function('return this')().require('vertx');
    vertxNext = vertx.runOnLoop || vertx.runOnContext;
    return useVertxTimer();
  } catch (e) {
    return useSetTimeout();
  }
}

var scheduleFlush = void 0;
// Decide what async method to use to triggering processing of queued callbacks:
if (isNode) {
  scheduleFlush = useNextTick();
} else if (BrowserMutationObserver) {
  scheduleFlush = useMutationObserver();
} else if (isWorker) {
  scheduleFlush = useMessageChannel();
} else if (browserWindow === undefined && typeof require === 'function') {
  scheduleFlush = attemptVertx();
} else {
  scheduleFlush = useSetTimeout();
}

function then(onFulfillment, onRejection) {
  var parent = this;

  var child = new this.constructor(noop);

  if (child[PROMISE_ID] === undefined) {
    makePromise(child);
  }

  var _state = parent._state;


  if (_state) {
    var callback = arguments[_state - 1];
    asap(function () {
      return invokeCallback(_state, child, callback, parent._result);
    });
  } else {
    subscribe(parent, child, onFulfillment, onRejection);
  }

  return child;
}

/**
  `Promise.resolve` returns a promise that will become resolved with the
  passed `value`. It is shorthand for the following:

  ```javascript
  let promise = new Promise(function(resolve, reject){
    resolve(1);
  });

  promise.then(function(value){
    // value === 1
  });
  ```

  Instead of writing the above, your code now simply becomes the following:

  ```javascript
  let promise = Promise.resolve(1);

  promise.then(function(value){
    // value === 1
  });
  ```

  @method resolve
  @static
  @param {Any} value value that the returned promise will be resolved with
  Useful for tooling.
  @return {Promise} a promise that will become fulfilled with the given
  `value`
*/
function resolve$1(object) {
  /*jshint validthis:true */
  var Constructor = this;

  if (object && typeof object === 'object' && object.constructor === Constructor) {
    return object;
  }

  var promise = new Constructor(noop);
  resolve(promise, object);
  return promise;
}

var PROMISE_ID = Math.random().toString(36).substring(2);

function noop() {}

var PENDING = void 0;
var FULFILLED = 1;
var REJECTED = 2;

var TRY_CATCH_ERROR = { error: null };

function selfFulfillment() {
  return new TypeError("You cannot resolve a promise with itself");
}

function cannotReturnOwn() {
  return new TypeError('A promises callback cannot return that same promise.');
}

function getThen(promise) {
  try {
    return promise.then;
  } catch (error) {
    TRY_CATCH_ERROR.error = error;
    return TRY_CATCH_ERROR;
  }
}

function tryThen(then$$1, value, fulfillmentHandler, rejectionHandler) {
  try {
    then$$1.call(value, fulfillmentHandler, rejectionHandler);
  } catch (e) {
    return e;
  }
}

function handleForeignThenable(promise, thenable, then$$1) {
  asap(function (promise) {
    var sealed = false;
    var error = tryThen(then$$1, thenable, function (value) {
      if (sealed) {
        return;
      }
      sealed = true;
      if (thenable !== value) {
        resolve(promise, value);
      } else {
        fulfill(promise, value);
      }
    }, function (reason) {
      if (sealed) {
        return;
      }
      sealed = true;

      reject(promise, reason);
    }, 'Settle: ' + (promise._label || ' unknown promise'));

    if (!sealed && error) {
      sealed = true;
      reject(promise, error);
    }
  }, promise);
}

function handleOwnThenable(promise, thenable) {
  if (thenable._state === FULFILLED) {
    fulfill(promise, thenable._result);
  } else if (thenable._state === REJECTED) {
    reject(promise, thenable._result);
  } else {
    subscribe(thenable, undefined, function (value) {
      return resolve(promise, value);
    }, function (reason) {
      return reject(promise, reason);
    });
  }
}

function handleMaybeThenable(promise, maybeThenable, then$$1) {
  if (maybeThenable.constructor === promise.constructor && then$$1 === then && maybeThenable.constructor.resolve === resolve$1) {
    handleOwnThenable(promise, maybeThenable);
  } else {
    if (then$$1 === TRY_CATCH_ERROR) {
      reject(promise, TRY_CATCH_ERROR.error);
      TRY_CATCH_ERROR.error = null;
    } else if (then$$1 === undefined) {
      fulfill(promise, maybeThenable);
    } else if (isFunction(then$$1)) {
      handleForeignThenable(promise, maybeThenable, then$$1);
    } else {
      fulfill(promise, maybeThenable);
    }
  }
}

function resolve(promise, value) {
  if (promise === value) {
    reject(promise, selfFulfillment());
  } else if (objectOrFunction(value)) {
    handleMaybeThenable(promise, value, getThen(value));
  } else {
    fulfill(promise, value);
  }
}

function publishRejection(promise) {
  if (promise._onerror) {
    promise._onerror(promise._result);
  }

  publish(promise);
}

function fulfill(promise, value) {
  if (promise._state !== PENDING) {
    return;
  }

  promise._result = value;
  promise._state = FULFILLED;

  if (promise._subscribers.length !== 0) {
    asap(publish, promise);
  }
}

function reject(promise, reason) {
  if (promise._state !== PENDING) {
    return;
  }
  promise._state = REJECTED;
  promise._result = reason;

  asap(publishRejection, promise);
}

function subscribe(parent, child, onFulfillment, onRejection) {
  var _subscribers = parent._subscribers;
  var length = _subscribers.length;


  parent._onerror = null;

  _subscribers[length] = child;
  _subscribers[length + FULFILLED] = onFulfillment;
  _subscribers[length + REJECTED] = onRejection;

  if (length === 0 && parent._state) {
    asap(publish, parent);
  }
}

function publish(promise) {
  var subscribers = promise._subscribers;
  var settled = promise._state;

  if (subscribers.length === 0) {
    return;
  }

  var child = void 0,
      callback = void 0,
      detail = promise._result;

  for (var i = 0; i < subscribers.length; i += 3) {
    child = subscribers[i];
    callback = subscribers[i + settled];

    if (child) {
      invokeCallback(settled, child, callback, detail);
    } else {
      callback(detail);
    }
  }

  promise._subscribers.length = 0;
}

function tryCatch(callback, detail) {
  try {
    return callback(detail);
  } catch (e) {
    TRY_CATCH_ERROR.error = e;
    return TRY_CATCH_ERROR;
  }
}

function invokeCallback(settled, promise, callback, detail) {
  var hasCallback = isFunction(callback),
      value = void 0,
      error = void 0,
      succeeded = void 0,
      failed = void 0;

  if (hasCallback) {
    value = tryCatch(callback, detail);

    if (value === TRY_CATCH_ERROR) {
      failed = true;
      error = value.error;
      value.error = null;
    } else {
      succeeded = true;
    }

    if (promise === value) {
      reject(promise, cannotReturnOwn());
      return;
    }
  } else {
    value = detail;
    succeeded = true;
  }

  if (promise._state !== PENDING) {
    // noop
  } else if (hasCallback && succeeded) {
    resolve(promise, value);
  } else if (failed) {
    reject(promise, error);
  } else if (settled === FULFILLED) {
    fulfill(promise, value);
  } else if (settled === REJECTED) {
    reject(promise, value);
  }
}

function initializePromise(promise, resolver) {
  try {
    resolver(function resolvePromise(value) {
      resolve(promise, value);
    }, function rejectPromise(reason) {
      reject(promise, reason);
    });
  } catch (e) {
    reject(promise, e);
  }
}

var id = 0;
function nextId() {
  return id++;
}

function makePromise(promise) {
  promise[PROMISE_ID] = id++;
  promise._state = undefined;
  promise._result = undefined;
  promise._subscribers = [];
}

function validationError() {
  return new Error('Array Methods must be provided an Array');
}

var Enumerator = function () {
  function Enumerator(Constructor, input) {
    this._instanceConstructor = Constructor;
    this.promise = new Constructor(noop);

    if (!this.promise[PROMISE_ID]) {
      makePromise(this.promise);
    }

    if (isArray(input)) {
      this.length = input.length;
      this._remaining = input.length;

      this._result = new Array(this.length);

      if (this.length === 0) {
        fulfill(this.promise, this._result);
      } else {
        this.length = this.length || 0;
        this._enumerate(input);
        if (this._remaining === 0) {
          fulfill(this.promise, this._result);
        }
      }
    } else {
      reject(this.promise, validationError());
    }
  }

  Enumerator.prototype._enumerate = function _enumerate(input) {
    for (var i = 0; this._state === PENDING && i < input.length; i++) {
      this._eachEntry(input[i], i);
    }
  };

  Enumerator.prototype._eachEntry = function _eachEntry(entry, i) {
    var c = this._instanceConstructor;
    var resolve$$1 = c.resolve;


    if (resolve$$1 === resolve$1) {
      var _then = getThen(entry);

      if (_then === then && entry._state !== PENDING) {
        this._settledAt(entry._state, i, entry._result);
      } else if (typeof _then !== 'function') {
        this._remaining--;
        this._result[i] = entry;
      } else if (c === Promise$1) {
        var promise = new c(noop);
        handleMaybeThenable(promise, entry, _then);
        this._willSettleAt(promise, i);
      } else {
        this._willSettleAt(new c(function (resolve$$1) {
          return resolve$$1(entry);
        }), i);
      }
    } else {
      this._willSettleAt(resolve$$1(entry), i);
    }
  };

  Enumerator.prototype._settledAt = function _settledAt(state, i, value) {
    var promise = this.promise;


    if (promise._state === PENDING) {
      this._remaining--;

      if (state === REJECTED) {
        reject(promise, value);
      } else {
        this._result[i] = value;
      }
    }

    if (this._remaining === 0) {
      fulfill(promise, this._result);
    }
  };

  Enumerator.prototype._willSettleAt = function _willSettleAt(promise, i) {
    var enumerator = this;

    subscribe(promise, undefined, function (value) {
      return enumerator._settledAt(FULFILLED, i, value);
    }, function (reason) {
      return enumerator._settledAt(REJECTED, i, reason);
    });
  };

  return Enumerator;
}();

/**
  `Promise.all` accepts an array of promises, and returns a new promise which
  is fulfilled with an array of fulfillment values for the passed promises, or
  rejected with the reason of the first passed promise to be rejected. It casts all
  elements of the passed iterable to promises as it runs this algorithm.

  Example:

  ```javascript
  let promise1 = resolve(1);
  let promise2 = resolve(2);
  let promise3 = resolve(3);
  let promises = [ promise1, promise2, promise3 ];

  Promise.all(promises).then(function(array){
    // The array here would be [ 1, 2, 3 ];
  });
  ```

  If any of the `promises` given to `all` are rejected, the first promise
  that is rejected will be given as an argument to the returned promises's
  rejection handler. For example:

  Example:

  ```javascript
  let promise1 = resolve(1);
  let promise2 = reject(new Error("2"));
  let promise3 = reject(new Error("3"));
  let promises = [ promise1, promise2, promise3 ];

  Promise.all(promises).then(function(array){
    // Code here never runs because there are rejected promises!
  }, function(error) {
    // error.message === "2"
  });
  ```

  @method all
  @static
  @param {Array} entries array of promises
  @param {String} label optional string for labeling the promise.
  Useful for tooling.
  @return {Promise} promise that is fulfilled when all `promises` have been
  fulfilled, or rejected if any of them become rejected.
  @static
*/
function all(entries) {
  return new Enumerator(this, entries).promise;
}

/**
  `Promise.race` returns a new promise which is settled in the same way as the
  first passed promise to settle.

  Example:

  ```javascript
  let promise1 = new Promise(function(resolve, reject){
    setTimeout(function(){
      resolve('promise 1');
    }, 200);
  });

  let promise2 = new Promise(function(resolve, reject){
    setTimeout(function(){
      resolve('promise 2');
    }, 100);
  });

  Promise.race([promise1, promise2]).then(function(result){
    // result === 'promise 2' because it was resolved before promise1
    // was resolved.
  });
  ```

  `Promise.race` is deterministic in that only the state of the first
  settled promise matters. For example, even if other promises given to the
  `promises` array argument are resolved, but the first settled promise has
  become rejected before the other promises became fulfilled, the returned
  promise will become rejected:

  ```javascript
  let promise1 = new Promise(function(resolve, reject){
    setTimeout(function(){
      resolve('promise 1');
    }, 200);
  });

  let promise2 = new Promise(function(resolve, reject){
    setTimeout(function(){
      reject(new Error('promise 2'));
    }, 100);
  });

  Promise.race([promise1, promise2]).then(function(result){
    // Code here never runs
  }, function(reason){
    // reason.message === 'promise 2' because promise 2 became rejected before
    // promise 1 became fulfilled
  });
  ```

  An example real-world use case is implementing timeouts:

  ```javascript
  Promise.race([ajax('foo.json'), timeout(5000)])
  ```

  @method race
  @static
  @param {Array} promises array of promises to observe
  Useful for tooling.
  @return {Promise} a promise which settles in the same way as the first passed
  promise to settle.
*/
function race(entries) {
  /*jshint validthis:true */
  var Constructor = this;

  if (!isArray(entries)) {
    return new Constructor(function (_, reject) {
      return reject(new TypeError('You must pass an array to race.'));
    });
  } else {
    return new Constructor(function (resolve, reject) {
      var length = entries.length;
      for (var i = 0; i < length; i++) {
        Constructor.resolve(entries[i]).then(resolve, reject);
      }
    });
  }
}

/**
  `Promise.reject` returns a promise rejected with the passed `reason`.
  It is shorthand for the following:

  ```javascript
  let promise = new Promise(function(resolve, reject){
    reject(new Error('WHOOPS'));
  });

  promise.then(function(value){
    // Code here doesn't run because the promise is rejected!
  }, function(reason){
    // reason.message === 'WHOOPS'
  });
  ```

  Instead of writing the above, your code now simply becomes the following:

  ```javascript
  let promise = Promise.reject(new Error('WHOOPS'));

  promise.then(function(value){
    // Code here doesn't run because the promise is rejected!
  }, function(reason){
    // reason.message === 'WHOOPS'
  });
  ```

  @method reject
  @static
  @param {Any} reason value that the returned promise will be rejected with.
  Useful for tooling.
  @return {Promise} a promise rejected with the given `reason`.
*/
function reject$1(reason) {
  /*jshint validthis:true */
  var Constructor = this;
  var promise = new Constructor(noop);
  reject(promise, reason);
  return promise;
}

function needsResolver() {
  throw new TypeError('You must pass a resolver function as the first argument to the promise constructor');
}

function needsNew() {
  throw new TypeError("Failed to construct 'Promise': Please use the 'new' operator, this object constructor cannot be called as a function.");
}

/**
  Promise objects represent the eventual result of an asynchronous operation. The
  primary way of interacting with a promise is through its `then` method, which
  registers callbacks to receive either a promise's eventual value or the reason
  why the promise cannot be fulfilled.

  Terminology
  -----------

  - `promise` is an object or function with a `then` method whose behavior conforms to this specification.
  - `thenable` is an object or function that defines a `then` method.
  - `value` is any legal JavaScript value (including undefined, a thenable, or a promise).
  - `exception` is a value that is thrown using the throw statement.
  - `reason` is a value that indicates why a promise was rejected.
  - `settled` the final resting state of a promise, fulfilled or rejected.

  A promise can be in one of three states: pending, fulfilled, or rejected.

  Promises that are fulfilled have a fulfillment value and are in the fulfilled
  state.  Promises that are rejected have a rejection reason and are in the
  rejected state.  A fulfillment value is never a thenable.

  Promises can also be said to *resolve* a value.  If this value is also a
  promise, then the original promise's settled state will match the value's
  settled state.  So a promise that *resolves* a promise that rejects will
  itself reject, and a promise that *resolves* a promise that fulfills will
  itself fulfill.


  Basic Usage:
  ------------

  ```js
  let promise = new Promise(function(resolve, reject) {
    // on success
    resolve(value);

    // on failure
    reject(reason);
  });

  promise.then(function(value) {
    // on fulfillment
  }, function(reason) {
    // on rejection
  });
  ```

  Advanced Usage:
  ---------------

  Promises shine when abstracting away asynchronous interactions such as
  `XMLHttpRequest`s.

  ```js
  function getJSON(url) {
    return new Promise(function(resolve, reject){
      let xhr = new XMLHttpRequest();

      xhr.open('GET', url);
      xhr.onreadystatechange = handler;
      xhr.responseType = 'json';
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.send();

      function handler() {
        if (this.readyState === this.DONE) {
          if (this.status === 200) {
            resolve(this.response);
          } else {
            reject(new Error('getJSON: `' + url + '` failed with status: [' + this.status + ']'));
          }
        }
      };
    });
  }

  getJSON('/posts.json').then(function(json) {
    // on fulfillment
  }, function(reason) {
    // on rejection
  });
  ```

  Unlike callbacks, promises are great composable primitives.

  ```js
  Promise.all([
    getJSON('/posts'),
    getJSON('/comments')
  ]).then(function(values){
    values[0] // => postsJSON
    values[1] // => commentsJSON

    return values;
  });
  ```

  @class Promise
  @param {Function} resolver
  Useful for tooling.
  @constructor
*/

var Promise$1 = function () {
  function Promise(resolver) {
    this[PROMISE_ID] = nextId();
    this._result = this._state = undefined;
    this._subscribers = [];

    if (noop !== resolver) {
      typeof resolver !== 'function' && needsResolver();
      this instanceof Promise ? initializePromise(this, resolver) : needsNew();
    }
  }

  /**
  The primary way of interacting with a promise is through its `then` method,
  which registers callbacks to receive either a promise's eventual value or the
  reason why the promise cannot be fulfilled.
   ```js
  findUser().then(function(user){
    // user is available
  }, function(reason){
    // user is unavailable, and you are given the reason why
  });
  ```
   Chaining
  --------
   The return value of `then` is itself a promise.  This second, 'downstream'
  promise is resolved with the return value of the first promise's fulfillment
  or rejection handler, or rejected if the handler throws an exception.
   ```js
  findUser().then(function (user) {
    return user.name;
  }, function (reason) {
    return 'default name';
  }).then(function (userName) {
    // If `findUser` fulfilled, `userName` will be the user's name, otherwise it
    // will be `'default name'`
  });
   findUser().then(function (user) {
    throw new Error('Found user, but still unhappy');
  }, function (reason) {
    throw new Error('`findUser` rejected and we're unhappy');
  }).then(function (value) {
    // never reached
  }, function (reason) {
    // if `findUser` fulfilled, `reason` will be 'Found user, but still unhappy'.
    // If `findUser` rejected, `reason` will be '`findUser` rejected and we're unhappy'.
  });
  ```
  If the downstream promise does not specify a rejection handler, rejection reasons will be propagated further downstream.
   ```js
  findUser().then(function (user) {
    throw new PedagogicalException('Upstream error');
  }).then(function (value) {
    // never reached
  }).then(function (value) {
    // never reached
  }, function (reason) {
    // The `PedgagocialException` is propagated all the way down to here
  });
  ```
   Assimilation
  ------------
   Sometimes the value you want to propagate to a downstream promise can only be
  retrieved asynchronously. This can be achieved by returning a promise in the
  fulfillment or rejection handler. The downstream promise will then be pending
  until the returned promise is settled. This is called *assimilation*.
   ```js
  findUser().then(function (user) {
    return findCommentsByAuthor(user);
  }).then(function (comments) {
    // The user's comments are now available
  });
  ```
   If the assimliated promise rejects, then the downstream promise will also reject.
   ```js
  findUser().then(function (user) {
    return findCommentsByAuthor(user);
  }).then(function (comments) {
    // If `findCommentsByAuthor` fulfills, we'll have the value here
  }, function (reason) {
    // If `findCommentsByAuthor` rejects, we'll have the reason here
  });
  ```
   Simple Example
  --------------
   Synchronous Example
   ```javascript
  let result;
   try {
    result = findResult();
    // success
  } catch(reason) {
    // failure
  }
  ```
   Errback Example
   ```js
  findResult(function(result, err){
    if (err) {
      // failure
    } else {
      // success
    }
  });
  ```
   Promise Example;
   ```javascript
  findResult().then(function(result){
    // success
  }, function(reason){
    // failure
  });
  ```
   Advanced Example
  --------------
   Synchronous Example
   ```javascript
  let author, books;
   try {
    author = findAuthor();
    books  = findBooksByAuthor(author);
    // success
  } catch(reason) {
    // failure
  }
  ```
   Errback Example
   ```js
   function foundBooks(books) {
   }
   function failure(reason) {
   }
   findAuthor(function(author, err){
    if (err) {
      failure(err);
      // failure
    } else {
      try {
        findBoooksByAuthor(author, function(books, err) {
          if (err) {
            failure(err);
          } else {
            try {
              foundBooks(books);
            } catch(reason) {
              failure(reason);
            }
          }
        });
      } catch(error) {
        failure(err);
      }
      // success
    }
  });
  ```
   Promise Example;
   ```javascript
  findAuthor().
    then(findBooksByAuthor).
    then(function(books){
      // found books
  }).catch(function(reason){
    // something went wrong
  });
  ```
   @method then
  @param {Function} onFulfilled
  @param {Function} onRejected
  Useful for tooling.
  @return {Promise}
  */

  /**
  `catch` is simply sugar for `then(undefined, onRejection)` which makes it the same
  as the catch block of a try/catch statement.
  ```js
  function findAuthor(){
  throw new Error('couldn't find that author');
  }
  // synchronous
  try {
  findAuthor();
  } catch(reason) {
  // something went wrong
  }
  // async with promises
  findAuthor().catch(function(reason){
  // something went wrong
  });
  ```
  @method catch
  @param {Function} onRejection
  Useful for tooling.
  @return {Promise}
  */


  Promise.prototype.catch = function _catch(onRejection) {
    return this.then(null, onRejection);
  };

  /**
    `finally` will be invoked regardless of the promise's fate just as native
    try/catch/finally behaves
  
    Synchronous example:
  
    ```js
    findAuthor() {
      if (Math.random() > 0.5) {
        throw new Error();
      }
      return new Author();
    }
  
    try {
      return findAuthor(); // succeed or fail
    } catch(error) {
      return findOtherAuther();
    } finally {
      // always runs
      // doesn't affect the return value
    }
    ```
  
    Asynchronous example:
  
    ```js
    findAuthor().catch(function(reason){
      return findOtherAuther();
    }).finally(function(){
      // author was either found, or not
    });
    ```
  
    @method finally
    @param {Function} callback
    @return {Promise}
  */


  Promise.prototype.finally = function _finally(callback) {
    var promise = this;
    var constructor = promise.constructor;

    if (isFunction(callback)) {
      return promise.then(function (value) {
        return constructor.resolve(callback()).then(function () {
          return value;
        });
      }, function (reason) {
        return constructor.resolve(callback()).then(function () {
          throw reason;
        });
      });
    }

    return promise.then(callback, callback);
  };

  return Promise;
}();

Promise$1.prototype.then = then;
Promise$1.all = all;
Promise$1.race = race;
Promise$1.resolve = resolve$1;
Promise$1.reject = reject$1;
Promise$1._setScheduler = setScheduler;
Promise$1._setAsap = setAsap;
Promise$1._asap = asap;

/*global self*/
function polyfill() {
  var local = void 0;

  if (typeof global !== 'undefined') {
    local = global;
  } else if (typeof self !== 'undefined') {
    local = self;
  } else {
    try {
      local = Function('return this')();
    } catch (e) {
      throw new Error('polyfill failed because global object is unavailable in this environment');
    }
  }

  var P = local.Promise;

  if (P) {
    var promiseToString = null;
    try {
      promiseToString = Object.prototype.toString.call(P.resolve());
    } catch (e) {
      // silently ignored
    }

    if (promiseToString === '[object Promise]' && !P.cast) {
      return;
    }
  }

  local.Promise = Promise$1;
}

// Strange compat..
Promise$1.polyfill = polyfill;
Promise$1.Promise = Promise$1;

return Promise$1;

})));





}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"_process":20}],6:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var objectCreate = Object.create || objectCreatePolyfill
var objectKeys = Object.keys || objectKeysPolyfill
var bind = Function.prototype.bind || functionBindPolyfill

function EventEmitter() {
  if (!this._events || !Object.prototype.hasOwnProperty.call(this, '_events')) {
    this._events = objectCreate(null);
    this._eventsCount = 0;
  }

  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
var defaultMaxListeners = 10;

var hasDefineProperty;
try {
  var o = {};
  if (Object.defineProperty) Object.defineProperty(o, 'x', { value: 0 });
  hasDefineProperty = o.x === 0;
} catch (err) { hasDefineProperty = false }
if (hasDefineProperty) {
  Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
    enumerable: true,
    get: function() {
      return defaultMaxListeners;
    },
    set: function(arg) {
      // check whether the input is a positive number (whose value is zero or
      // greater and not a NaN).
      if (typeof arg !== 'number' || arg < 0 || arg !== arg)
        throw new TypeError('"defaultMaxListeners" must be a positive number');
      defaultMaxListeners = arg;
    }
  });
} else {
  EventEmitter.defaultMaxListeners = defaultMaxListeners;
}

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
  if (typeof n !== 'number' || n < 0 || isNaN(n))
    throw new TypeError('"n" argument must be a positive number');
  this._maxListeners = n;
  return this;
};

function $getMaxListeners(that) {
  if (that._maxListeners === undefined)
    return EventEmitter.defaultMaxListeners;
  return that._maxListeners;
}

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
  return $getMaxListeners(this);
};

// These standalone emit* functions are used to optimize calling of event
// handlers for fast cases because emit() itself often has a variable number of
// arguments and can be deoptimized because of that. These functions always have
// the same number of arguments and thus do not get deoptimized, so the code
// inside them can execute faster.
function emitNone(handler, isFn, self) {
  if (isFn)
    handler.call(self);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self);
  }
}
function emitOne(handler, isFn, self, arg1) {
  if (isFn)
    handler.call(self, arg1);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1);
  }
}
function emitTwo(handler, isFn, self, arg1, arg2) {
  if (isFn)
    handler.call(self, arg1, arg2);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2);
  }
}
function emitThree(handler, isFn, self, arg1, arg2, arg3) {
  if (isFn)
    handler.call(self, arg1, arg2, arg3);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2, arg3);
  }
}

function emitMany(handler, isFn, self, args) {
  if (isFn)
    handler.apply(self, args);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].apply(self, args);
  }
}

EventEmitter.prototype.emit = function emit(type) {
  var er, handler, len, args, i, events;
  var doError = (type === 'error');

  events = this._events;
  if (events)
    doError = (doError && events.error == null);
  else if (!doError)
    return false;

  // If there is no 'error' event listener then throw.
  if (doError) {
    if (arguments.length > 1)
      er = arguments[1];
    if (er instanceof Error) {
      throw er; // Unhandled 'error' event
    } else {
      // At least give some kind of context to the user
      var err = new Error('Unhandled "error" event. (' + er + ')');
      err.context = er;
      throw err;
    }
    return false;
  }

  handler = events[type];

  if (!handler)
    return false;

  var isFn = typeof handler === 'function';
  len = arguments.length;
  switch (len) {
      // fast cases
    case 1:
      emitNone(handler, isFn, this);
      break;
    case 2:
      emitOne(handler, isFn, this, arguments[1]);
      break;
    case 3:
      emitTwo(handler, isFn, this, arguments[1], arguments[2]);
      break;
    case 4:
      emitThree(handler, isFn, this, arguments[1], arguments[2], arguments[3]);
      break;
      // slower
    default:
      args = new Array(len - 1);
      for (i = 1; i < len; i++)
        args[i - 1] = arguments[i];
      emitMany(handler, isFn, this, args);
  }

  return true;
};

function _addListener(target, type, listener, prepend) {
  var m;
  var events;
  var existing;

  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');

  events = target._events;
  if (!events) {
    events = target._events = objectCreate(null);
    target._eventsCount = 0;
  } else {
    // To avoid recursion in the case that type === "newListener"! Before
    // adding it to the listeners, first emit "newListener".
    if (events.newListener) {
      target.emit('newListener', type,
          listener.listener ? listener.listener : listener);

      // Re-assign `events` because a newListener handler could have caused the
      // this._events to be assigned to a new object
      events = target._events;
    }
    existing = events[type];
  }

  if (!existing) {
    // Optimize the case of one listener. Don't need the extra array object.
    existing = events[type] = listener;
    ++target._eventsCount;
  } else {
    if (typeof existing === 'function') {
      // Adding the second element, need to change to array.
      existing = events[type] =
          prepend ? [listener, existing] : [existing, listener];
    } else {
      // If we've already got an array, just append.
      if (prepend) {
        existing.unshift(listener);
      } else {
        existing.push(listener);
      }
    }

    // Check for listener leak
    if (!existing.warned) {
      m = $getMaxListeners(target);
      if (m && m > 0 && existing.length > m) {
        existing.warned = true;
        var w = new Error('Possible EventEmitter memory leak detected. ' +
            existing.length + ' "' + String(type) + '" listeners ' +
            'added. Use emitter.setMaxListeners() to ' +
            'increase limit.');
        w.name = 'MaxListenersExceededWarning';
        w.emitter = target;
        w.type = type;
        w.count = existing.length;
        if (typeof console === 'object' && console.warn) {
          console.warn('%s: %s', w.name, w.message);
        }
      }
    }
  }

  return target;
}

EventEmitter.prototype.addListener = function addListener(type, listener) {
  return _addListener(this, type, listener, false);
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener =
    function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };

function onceWrapper() {
  if (!this.fired) {
    this.target.removeListener(this.type, this.wrapFn);
    this.fired = true;
    switch (arguments.length) {
      case 0:
        return this.listener.call(this.target);
      case 1:
        return this.listener.call(this.target, arguments[0]);
      case 2:
        return this.listener.call(this.target, arguments[0], arguments[1]);
      case 3:
        return this.listener.call(this.target, arguments[0], arguments[1],
            arguments[2]);
      default:
        var args = new Array(arguments.length);
        for (var i = 0; i < args.length; ++i)
          args[i] = arguments[i];
        this.listener.apply(this.target, args);
    }
  }
}

function _onceWrap(target, type, listener) {
  var state = { fired: false, wrapFn: undefined, target: target, type: type, listener: listener };
  var wrapped = bind.call(onceWrapper, state);
  wrapped.listener = listener;
  state.wrapFn = wrapped;
  return wrapped;
}

EventEmitter.prototype.once = function once(type, listener) {
  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');
  this.on(type, _onceWrap(this, type, listener));
  return this;
};

EventEmitter.prototype.prependOnceListener =
    function prependOnceListener(type, listener) {
      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };

// Emits a 'removeListener' event if and only if the listener was removed.
EventEmitter.prototype.removeListener =
    function removeListener(type, listener) {
      var list, events, position, i, originalListener;

      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');

      events = this._events;
      if (!events)
        return this;

      list = events[type];
      if (!list)
        return this;

      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = objectCreate(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit('removeListener', type, list.listener || listener);
        }
      } else if (typeof list !== 'function') {
        position = -1;

        for (i = list.length - 1; i >= 0; i--) {
          if (list[i] === listener || list[i].listener === listener) {
            originalListener = list[i].listener;
            position = i;
            break;
          }
        }

        if (position < 0)
          return this;

        if (position === 0)
          list.shift();
        else
          spliceOne(list, position);

        if (list.length === 1)
          events[type] = list[0];

        if (events.removeListener)
          this.emit('removeListener', type, originalListener || listener);
      }

      return this;
    };

EventEmitter.prototype.removeAllListeners =
    function removeAllListeners(type) {
      var listeners, events, i;

      events = this._events;
      if (!events)
        return this;

      // not listening for removeListener, no need to emit
      if (!events.removeListener) {
        if (arguments.length === 0) {
          this._events = objectCreate(null);
          this._eventsCount = 0;
        } else if (events[type]) {
          if (--this._eventsCount === 0)
            this._events = objectCreate(null);
          else
            delete events[type];
        }
        return this;
      }

      // emit removeListener for all listeners on all events
      if (arguments.length === 0) {
        var keys = objectKeys(events);
        var key;
        for (i = 0; i < keys.length; ++i) {
          key = keys[i];
          if (key === 'removeListener') continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners('removeListener');
        this._events = objectCreate(null);
        this._eventsCount = 0;
        return this;
      }

      listeners = events[type];

      if (typeof listeners === 'function') {
        this.removeListener(type, listeners);
      } else if (listeners) {
        // LIFO order
        for (i = listeners.length - 1; i >= 0; i--) {
          this.removeListener(type, listeners[i]);
        }
      }

      return this;
    };

function _listeners(target, type, unwrap) {
  var events = target._events;

  if (!events)
    return [];

  var evlistener = events[type];
  if (!evlistener)
    return [];

  if (typeof evlistener === 'function')
    return unwrap ? [evlistener.listener || evlistener] : [evlistener];

  return unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
}

EventEmitter.prototype.listeners = function listeners(type) {
  return _listeners(this, type, true);
};

EventEmitter.prototype.rawListeners = function rawListeners(type) {
  return _listeners(this, type, false);
};

EventEmitter.listenerCount = function(emitter, type) {
  if (typeof emitter.listenerCount === 'function') {
    return emitter.listenerCount(type);
  } else {
    return listenerCount.call(emitter, type);
  }
};

EventEmitter.prototype.listenerCount = listenerCount;
function listenerCount(type) {
  var events = this._events;

  if (events) {
    var evlistener = events[type];

    if (typeof evlistener === 'function') {
      return 1;
    } else if (evlistener) {
      return evlistener.length;
    }
  }

  return 0;
}

EventEmitter.prototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
};

// About 1.5x faster than the two-arg version of Array#splice().
function spliceOne(list, index) {
  for (var i = index, k = i + 1, n = list.length; k < n; i += 1, k += 1)
    list[i] = list[k];
  list.pop();
}

function arrayClone(arr, n) {
  var copy = new Array(n);
  for (var i = 0; i < n; ++i)
    copy[i] = arr[i];
  return copy;
}

function unwrapListeners(arr) {
  var ret = new Array(arr.length);
  for (var i = 0; i < ret.length; ++i) {
    ret[i] = arr[i].listener || arr[i];
  }
  return ret;
}

function objectCreatePolyfill(proto) {
  var F = function() {};
  F.prototype = proto;
  return new F;
}
function objectKeysPolyfill(obj) {
  var keys = [];
  for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) {
    keys.push(k);
  }
  return k;
}
function functionBindPolyfill(context) {
  var fn = this;
  return function () {
    return fn.apply(context, arguments);
  };
}

},{}],7:[function(require,module,exports){
/*
 * Fuzzy
 * https://github.com/myork/fuzzy
 *
 * Copyright (c) 2012 Matt York
 * Licensed under the MIT license.
 */

(function() {

var root = this;

var fuzzy = {};

// Use in node or in browser
if (typeof exports !== 'undefined') {
  module.exports = fuzzy;
} else {
  root.fuzzy = fuzzy;
}

// Return all elements of `array` that have a fuzzy
// match against `pattern`.
fuzzy.simpleFilter = function(pattern, array) {
  return array.filter(function(str) {
    return fuzzy.test(pattern, str);
  });
};

// Does `pattern` fuzzy match `str`?
fuzzy.test = function(pattern, str) {
  return fuzzy.match(pattern, str) !== null;
};

// If `pattern` matches `str`, wrap each matching character
// in `opts.pre` and `opts.post`. If no match, return null
fuzzy.match = function(pattern, str, opts) {
  opts = opts || {};
  var patternIdx = 0
    , result = []
    , len = str.length
    , totalScore = 0
    , currScore = 0
    // prefix
    , pre = opts.pre || ''
    // suffix
    , post = opts.post || ''
    // String to compare against. This might be a lowercase version of the
    // raw string
    , compareString =  opts.caseSensitive && str || str.toLowerCase()
    , ch;

  pattern = opts.caseSensitive && pattern || pattern.toLowerCase();

  // For each character in the string, either add it to the result
  // or wrap in template if it's the next string in the pattern
  for(var idx = 0; idx < len; idx++) {
    ch = str[idx];
    if(compareString[idx] === pattern[patternIdx]) {
      ch = pre + ch + post;
      patternIdx += 1;

      // consecutive characters should increase the score more than linearly
      currScore += 1 + currScore;
    } else {
      currScore = 0;
    }
    totalScore += currScore;
    result[result.length] = ch;
  }

  // return rendered string if we have a match for every char
  if(patternIdx === pattern.length) {
    // if the string is an exact match with pattern, totalScore should be maxed
    totalScore = (compareString === pattern) ? Infinity : totalScore;
    return {rendered: result.join(''), score: totalScore};
  }

  return null;
};

// The normal entry point. Filters `arr` for matches against `pattern`.
// It returns an array with matching values of the type:
//
//     [{
//         string:   '<b>lah' // The rendered string
//       , index:    2        // The index of the element in `arr`
//       , original: 'blah'   // The original element in `arr`
//     }]
//
// `opts` is an optional argument bag. Details:
//
//    opts = {
//        // string to put before a matching character
//        pre:     '<b>'
//
//        // string to put after matching character
//      , post:    '</b>'
//
//        // Optional function. Input is an entry in the given arr`,
//        // output should be the string to test `pattern` against.
//        // In this example, if `arr = [{crying: 'koala'}]` we would return
//        // 'koala'.
//      , extract: function(arg) { return arg.crying; }
//    }
fuzzy.filter = function(pattern, arr, opts) {
  if(!arr || arr.length === 0) {
    return [];
  }
  if (typeof pattern !== 'string') {
    return arr;
  }
  opts = opts || {};
  return arr
    .reduce(function(prev, element, idx, arr) {
      var str = element;
      if(opts.extract) {
        str = opts.extract(element);
      }
      var rendered = fuzzy.match(pattern, str, opts);
      if(rendered != null) {
        prev[prev.length] = {
            string: rendered.rendered
          , score: rendered.score
          , index: idx
          , original: element
        };
      }
      return prev;
    }, [])

    // Sort by score. Browsers are inconsistent wrt stable/unstable
    // sorting, so force stable by using the index in the case of tie.
    // See http://ofb.net/~sethml/is-sort-stable.html
    .sort(function(a,b) {
      var compare = b.score - a.score;
      if(compare) return compare;
      return a.index - b.index;
    });
};


}());


},{}],8:[function(require,module,exports){
(function (global){
/**
 * lodash (Custom Build) <https://lodash.com/>
 * Build: `lodash modularize exports="npm" -o ./`
 * Copyright jQuery Foundation and other contributors <https://jquery.org/>
 * Released under MIT license <https://lodash.com/license>
 * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
 * Copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
 */

/** Used as the `TypeError` message for "Functions" methods. */
var FUNC_ERROR_TEXT = 'Expected a function';

/** Used as references for various `Number` constants. */
var NAN = 0 / 0;

/** `Object#toString` result references. */
var symbolTag = '[object Symbol]';

/** Used to match leading and trailing whitespace. */
var reTrim = /^\s+|\s+$/g;

/** Used to detect bad signed hexadecimal string values. */
var reIsBadHex = /^[-+]0x[0-9a-f]+$/i;

/** Used to detect binary string values. */
var reIsBinary = /^0b[01]+$/i;

/** Used to detect octal string values. */
var reIsOctal = /^0o[0-7]+$/i;

/** Built-in method references without a dependency on `root`. */
var freeParseInt = parseInt;

/** Detect free variable `global` from Node.js. */
var freeGlobal = typeof global == 'object' && global && global.Object === Object && global;

/** Detect free variable `self`. */
var freeSelf = typeof self == 'object' && self && self.Object === Object && self;

/** Used as a reference to the global object. */
var root = freeGlobal || freeSelf || Function('return this')();

/** Used for built-in method references. */
var objectProto = Object.prototype;

/**
 * Used to resolve the
 * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
 * of values.
 */
var objectToString = objectProto.toString;

/* Built-in method references for those with the same name as other `lodash` methods. */
var nativeMax = Math.max,
    nativeMin = Math.min;

/**
 * Gets the timestamp of the number of milliseconds that have elapsed since
 * the Unix epoch (1 January 1970 00:00:00 UTC).
 *
 * @static
 * @memberOf _
 * @since 2.4.0
 * @category Date
 * @returns {number} Returns the timestamp.
 * @example
 *
 * _.defer(function(stamp) {
 *   console.log(_.now() - stamp);
 * }, _.now());
 * // => Logs the number of milliseconds it took for the deferred invocation.
 */
var now = function() {
  return root.Date.now();
};

/**
 * Creates a debounced function that delays invoking `func` until after `wait`
 * milliseconds have elapsed since the last time the debounced function was
 * invoked. The debounced function comes with a `cancel` method to cancel
 * delayed `func` invocations and a `flush` method to immediately invoke them.
 * Provide `options` to indicate whether `func` should be invoked on the
 * leading and/or trailing edge of the `wait` timeout. The `func` is invoked
 * with the last arguments provided to the debounced function. Subsequent
 * calls to the debounced function return the result of the last `func`
 * invocation.
 *
 * **Note:** If `leading` and `trailing` options are `true`, `func` is
 * invoked on the trailing edge of the timeout only if the debounced function
 * is invoked more than once during the `wait` timeout.
 *
 * If `wait` is `0` and `leading` is `false`, `func` invocation is deferred
 * until to the next tick, similar to `setTimeout` with a timeout of `0`.
 *
 * See [David Corbacho's article](https://css-tricks.com/debouncing-throttling-explained-examples/)
 * for details over the differences between `_.debounce` and `_.throttle`.
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Function
 * @param {Function} func The function to debounce.
 * @param {number} [wait=0] The number of milliseconds to delay.
 * @param {Object} [options={}] The options object.
 * @param {boolean} [options.leading=false]
 *  Specify invoking on the leading edge of the timeout.
 * @param {number} [options.maxWait]
 *  The maximum time `func` is allowed to be delayed before it's invoked.
 * @param {boolean} [options.trailing=true]
 *  Specify invoking on the trailing edge of the timeout.
 * @returns {Function} Returns the new debounced function.
 * @example
 *
 * // Avoid costly calculations while the window size is in flux.
 * jQuery(window).on('resize', _.debounce(calculateLayout, 150));
 *
 * // Invoke `sendMail` when clicked, debouncing subsequent calls.
 * jQuery(element).on('click', _.debounce(sendMail, 300, {
 *   'leading': true,
 *   'trailing': false
 * }));
 *
 * // Ensure `batchLog` is invoked once after 1 second of debounced calls.
 * var debounced = _.debounce(batchLog, 250, { 'maxWait': 1000 });
 * var source = new EventSource('/stream');
 * jQuery(source).on('message', debounced);
 *
 * // Cancel the trailing debounced invocation.
 * jQuery(window).on('popstate', debounced.cancel);
 */
function debounce(func, wait, options) {
  var lastArgs,
      lastThis,
      maxWait,
      result,
      timerId,
      lastCallTime,
      lastInvokeTime = 0,
      leading = false,
      maxing = false,
      trailing = true;

  if (typeof func != 'function') {
    throw new TypeError(FUNC_ERROR_TEXT);
  }
  wait = toNumber(wait) || 0;
  if (isObject(options)) {
    leading = !!options.leading;
    maxing = 'maxWait' in options;
    maxWait = maxing ? nativeMax(toNumber(options.maxWait) || 0, wait) : maxWait;
    trailing = 'trailing' in options ? !!options.trailing : trailing;
  }

  function invokeFunc(time) {
    var args = lastArgs,
        thisArg = lastThis;

    lastArgs = lastThis = undefined;
    lastInvokeTime = time;
    result = func.apply(thisArg, args);
    return result;
  }

  function leadingEdge(time) {
    // Reset any `maxWait` timer.
    lastInvokeTime = time;
    // Start the timer for the trailing edge.
    timerId = setTimeout(timerExpired, wait);
    // Invoke the leading edge.
    return leading ? invokeFunc(time) : result;
  }

  function remainingWait(time) {
    var timeSinceLastCall = time - lastCallTime,
        timeSinceLastInvoke = time - lastInvokeTime,
        result = wait - timeSinceLastCall;

    return maxing ? nativeMin(result, maxWait - timeSinceLastInvoke) : result;
  }

  function shouldInvoke(time) {
    var timeSinceLastCall = time - lastCallTime,
        timeSinceLastInvoke = time - lastInvokeTime;

    // Either this is the first call, activity has stopped and we're at the
    // trailing edge, the system time has gone backwards and we're treating
    // it as the trailing edge, or we've hit the `maxWait` limit.
    return (lastCallTime === undefined || (timeSinceLastCall >= wait) ||
      (timeSinceLastCall < 0) || (maxing && timeSinceLastInvoke >= maxWait));
  }

  function timerExpired() {
    var time = now();
    if (shouldInvoke(time)) {
      return trailingEdge(time);
    }
    // Restart the timer.
    timerId = setTimeout(timerExpired, remainingWait(time));
  }

  function trailingEdge(time) {
    timerId = undefined;

    // Only invoke if we have `lastArgs` which means `func` has been
    // debounced at least once.
    if (trailing && lastArgs) {
      return invokeFunc(time);
    }
    lastArgs = lastThis = undefined;
    return result;
  }

  function cancel() {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
    lastInvokeTime = 0;
    lastArgs = lastCallTime = lastThis = timerId = undefined;
  }

  function flush() {
    return timerId === undefined ? result : trailingEdge(now());
  }

  function debounced() {
    var time = now(),
        isInvoking = shouldInvoke(time);

    lastArgs = arguments;
    lastThis = this;
    lastCallTime = time;

    if (isInvoking) {
      if (timerId === undefined) {
        return leadingEdge(lastCallTime);
      }
      if (maxing) {
        // Handle invocations in a tight loop.
        timerId = setTimeout(timerExpired, wait);
        return invokeFunc(lastCallTime);
      }
    }
    if (timerId === undefined) {
      timerId = setTimeout(timerExpired, wait);
    }
    return result;
  }
  debounced.cancel = cancel;
  debounced.flush = flush;
  return debounced;
}

/**
 * Checks if `value` is the
 * [language type](http://www.ecma-international.org/ecma-262/7.0/#sec-ecmascript-language-types)
 * of `Object`. (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an object, else `false`.
 * @example
 *
 * _.isObject({});
 * // => true
 *
 * _.isObject([1, 2, 3]);
 * // => true
 *
 * _.isObject(_.noop);
 * // => true
 *
 * _.isObject(null);
 * // => false
 */
function isObject(value) {
  var type = typeof value;
  return !!value && (type == 'object' || type == 'function');
}

/**
 * Checks if `value` is object-like. A value is object-like if it's not `null`
 * and has a `typeof` result of "object".
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
 * @example
 *
 * _.isObjectLike({});
 * // => true
 *
 * _.isObjectLike([1, 2, 3]);
 * // => true
 *
 * _.isObjectLike(_.noop);
 * // => false
 *
 * _.isObjectLike(null);
 * // => false
 */
function isObjectLike(value) {
  return !!value && typeof value == 'object';
}

/**
 * Checks if `value` is classified as a `Symbol` primitive or object.
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a symbol, else `false`.
 * @example
 *
 * _.isSymbol(Symbol.iterator);
 * // => true
 *
 * _.isSymbol('abc');
 * // => false
 */
function isSymbol(value) {
  return typeof value == 'symbol' ||
    (isObjectLike(value) && objectToString.call(value) == symbolTag);
}

/**
 * Converts `value` to a number.
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to process.
 * @returns {number} Returns the number.
 * @example
 *
 * _.toNumber(3.2);
 * // => 3.2
 *
 * _.toNumber(Number.MIN_VALUE);
 * // => 5e-324
 *
 * _.toNumber(Infinity);
 * // => Infinity
 *
 * _.toNumber('3.2');
 * // => 3.2
 */
function toNumber(value) {
  if (typeof value == 'number') {
    return value;
  }
  if (isSymbol(value)) {
    return NAN;
  }
  if (isObject(value)) {
    var other = typeof value.valueOf == 'function' ? value.valueOf() : value;
    value = isObject(other) ? (other + '') : other;
  }
  if (typeof value != 'string') {
    return value === 0 ? value : +value;
  }
  value = value.replace(reTrim, '');
  var isBinary = reIsBinary.test(value);
  return (isBinary || reIsOctal.test(value))
    ? freeParseInt(value.slice(2), isBinary ? 2 : 8)
    : (reIsBadHex.test(value) ? NAN : +value);
}

module.exports = debounce;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],9:[function(require,module,exports){
/* Mapbox GL JS is licensed under the 3-Clause BSD License. Full text of license: https://github.com/mapbox/mapbox-gl-js/blob/v0.49.0/LICENSE.txt */
(function (global, factory) {
typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
typeof define === 'function' && define.amd ? define(factory) :
(global.mapboxgl = factory());
}(this, (function () { 'use strict';

/* eslint-disable */

var shared, worker, mapboxgl;
// define gets called three times: one for each chunk. we rely on the order
// they're imported to know which is which
function define(_, chunk) {
if (!shared) {
    shared = chunk;
} else if (!worker) {
    worker = chunk;
} else {
    var workerBundleString = 'var sharedChunk = {}; (' + shared + ')(sharedChunk); (' + worker + ')(sharedChunk);'

    var sharedChunk = {};
    shared(sharedChunk);
    mapboxgl = chunk(sharedChunk);
    mapboxgl.workerUrl = window.URL.createObjectURL(new Blob([workerBundleString], { type: 'text/javascript' }));
}
}


define(["exports"],function(t){"use strict";function e(t,e){return t(e={exports:{}},e.exports),e.exports}var r=n;function n(t,e,r,n){this.cx=3*t,this.bx=3*(r-t)-this.cx,this.ax=1-this.cx-this.bx,this.cy=3*e,this.by=3*(n-e)-this.cy,this.ay=1-this.cy-this.by,this.p1x=t,this.p1y=n,this.p2x=r,this.p2y=n;}n.prototype.sampleCurveX=function(t){return ((this.ax*t+this.bx)*t+this.cx)*t},n.prototype.sampleCurveY=function(t){return ((this.ay*t+this.by)*t+this.cy)*t},n.prototype.sampleCurveDerivativeX=function(t){return (3*this.ax*t+2*this.bx)*t+this.cx},n.prototype.solveCurveX=function(t,e){var r,n,i,a,o;for(void 0===e&&(e=1e-6),i=t,o=0;o<8;o++){if(a=this.sampleCurveX(i)-t,Math.abs(a)<e)return i;var s=this.sampleCurveDerivativeX(i);if(Math.abs(s)<1e-6)break;i-=a/s;}if((i=t)<(r=0))return r;if(i>(n=1))return n;for(;r<n;){if(a=this.sampleCurveX(i),Math.abs(a-t)<e)return i;t>a?r=i:n=i,i=.5*(n-r)+r;}return i},n.prototype.solve=function(t,e){return this.sampleCurveY(this.solveCurveX(t,e))};var i=function(t,e,r){this.column=t,this.row=e,this.zoom=r;};i.prototype.clone=function(){return new i(this.column,this.row,this.zoom)},i.prototype.zoomTo=function(t){return this.clone()._zoomTo(t)},i.prototype.sub=function(t){return this.clone()._sub(t)},i.prototype._zoomTo=function(t){var e=Math.pow(2,t-this.zoom);return this.column*=e,this.row*=e,this.zoom=t,this},i.prototype._sub=function(t){return t=t.zoomTo(this.zoom),this.column-=t.column,this.row-=t.row,this};var a=o;function o(t,e){this.x=t,this.y=e;}function s(t,e){if(Array.isArray(t)){if(!Array.isArray(e)||t.length!==e.length)return !1;for(var r=0;r<t.length;r++)if(!s(t[r],e[r]))return !1;return !0}if("object"==typeof t&&null!==t&&null!==e){if("object"!=typeof e)return !1;if(Object.keys(t).length!==Object.keys(e).length)return !1;for(var n in t)if(!s(t[n],e[n]))return !1;return !0}return t===e}function u(t,e,n,i){var a=new r(t,e,n,i);return function(t){return a.solve(t)}}o.prototype={clone:function(){return new o(this.x,this.y)},add:function(t){return this.clone()._add(t)},sub:function(t){return this.clone()._sub(t)},multByPoint:function(t){return this.clone()._multByPoint(t)},divByPoint:function(t){return this.clone()._divByPoint(t)},mult:function(t){return this.clone()._mult(t)},div:function(t){return this.clone()._div(t)},rotate:function(t){return this.clone()._rotate(t)},rotateAround:function(t,e){return this.clone()._rotateAround(t,e)},matMult:function(t){return this.clone()._matMult(t)},unit:function(){return this.clone()._unit()},perp:function(){return this.clone()._perp()},round:function(){return this.clone()._round()},mag:function(){return Math.sqrt(this.x*this.x+this.y*this.y)},equals:function(t){return this.x===t.x&&this.y===t.y},dist:function(t){return Math.sqrt(this.distSqr(t))},distSqr:function(t){var e=t.x-this.x,r=t.y-this.y;return e*e+r*r},angle:function(){return Math.atan2(this.y,this.x)},angleTo:function(t){return Math.atan2(this.y-t.y,this.x-t.x)},angleWith:function(t){return this.angleWithSep(t.x,t.y)},angleWithSep:function(t,e){return Math.atan2(this.x*e-this.y*t,this.x*t+this.y*e)},_matMult:function(t){var e=t[0]*this.x+t[1]*this.y,r=t[2]*this.x+t[3]*this.y;return this.x=e,this.y=r,this},_add:function(t){return this.x+=t.x,this.y+=t.y,this},_sub:function(t){return this.x-=t.x,this.y-=t.y,this},_mult:function(t){return this.x*=t,this.y*=t,this},_div:function(t){return this.x/=t,this.y/=t,this},_multByPoint:function(t){return this.x*=t.x,this.y*=t.y,this},_divByPoint:function(t){return this.x/=t.x,this.y/=t.y,this},_unit:function(){return this._div(this.mag()),this},_perp:function(){var t=this.y;return this.y=this.x,this.x=-t,this},_rotate:function(t){var e=Math.cos(t),r=Math.sin(t),n=e*this.x-r*this.y,i=r*this.x+e*this.y;return this.x=n,this.y=i,this},_rotateAround:function(t,e){var r=Math.cos(t),n=Math.sin(t),i=e.x+r*(this.x-e.x)-n*(this.y-e.y),a=e.y+n*(this.x-e.x)+r*(this.y-e.y);return this.x=i,this.y=a,this},_round:function(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}},o.convert=function(t){return t instanceof o?t:Array.isArray(t)?new o(t[0],t[1]):t};var p=u(.25,.1,.25,1);function l(t,e,r){return Math.min(r,Math.max(e,t))}function c(t){for(var e=[],r=arguments.length-1;r-- >0;)e[r]=arguments[r+1];for(var n=0,i=e;n<i.length;n+=1){var a=i[n];for(var o in a)t[o]=a[o];}return t}var h=1;function f(){return h++}function y(t,e){t.forEach(function(t){e[t]&&(e[t]=e[t].bind(e));});}function d(t,e){return -1!==t.indexOf(e,t.length-e.length)}function m(t,e,r){var n={};for(var i in t)n[i]=e.call(r||this,t[i],i,t);return n}function v(t,e,r){var n={};for(var i in t)e.call(r||this,t[i],i,t)&&(n[i]=t[i]);return n}function g(t){return Array.isArray(t)?t.map(g):"object"==typeof t&&t?m(t,g):t}var x={};function b(t){x[t]||("undefined"!=typeof console&&console.warn(t),x[t]=!0);}function _(t,e,r){return (r.y-t.y)*(e.x-t.x)>(e.y-t.y)*(r.x-t.x)}function w(t){for(var e=0,r=0,n=t.length,i=n-1,a=void 0,o=void 0;r<n;i=r++)a=t[r],e+=((o=t[i]).x-a.x)*(a.y+o.y);return e}var A=self.performance&&self.performance.now?self.performance.now.bind(self.performance):Date.now.bind(Date),k=self.requestAnimationFrame||self.mozRequestAnimationFrame||self.webkitRequestAnimationFrame||self.msRequestAnimationFrame,z=self.cancelAnimationFrame||self.mozCancelAnimationFrame||self.webkitCancelAnimationFrame||self.msCancelAnimationFrame,S={now:A,frame:function(t){var e=k(t);return {cancel:function(){return z(e)}}},getImageData:function(t){var e=self.document.createElement("canvas"),r=e.getContext("2d");if(!r)throw new Error("failed to create canvas 2d context");return e.width=t.width,e.height=t.height,r.drawImage(t,0,0,t.width,t.height),r.getImageData(0,0,t.width,t.height)},resolveURL:function(t){var e=self.document.createElement("a");return e.href=t,e.href},hardwareConcurrency:self.navigator.hardwareConcurrency||4,get devicePixelRatio(){return self.devicePixelRatio},supportsWebp:!1};if(self.document){var B=self.document.createElement("img");B.onload=function(){S.supportsWebp=!0;},B.src="data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAQAAAAfQ//73v/+BiOh/AAA=";}var I={Unknown:"Unknown",Style:"Style",Source:"Source",Tile:"Tile",Glyphs:"Glyphs",SpriteImage:"SpriteImage",SpriteJSON:"SpriteJSON",Image:"Image"};"function"==typeof Object.freeze&&Object.freeze(I);var V=function(t){function e(e,r,n){t.call(this,e),this.status=r,this.url=n,this.name=this.constructor.name,this.message=e;}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.toString=function(){return this.name+": "+this.message+" ("+this.status+"): "+this.url},e}(Error);function P(t){var e=new self.XMLHttpRequest;for(var r in e.open(t.method||"GET",t.url,!0),t.headers)e.setRequestHeader(r,t.headers[r]);return e.withCredentials="include"===t.credentials,e}var M=function(t,e){var r=P(t);return r.responseType="arraybuffer",r.onerror=function(){e(new Error(r.statusText));},r.onload=function(){var n=r.response;if(0===n.byteLength&&200===r.status)return e(new Error("http status 200 returned without content."));(r.status>=200&&r.status<300||0===r.status)&&r.response?e(null,{data:n,cacheControl:r.getResponseHeader("Cache-Control"),expires:r.getResponseHeader("Expires")}):e(new V(r.statusText,r.status,t.url));},r.send(),{cancel:function(){return r.abort()}}};function C(t,e,r){r[t]&&-1!==r[t].indexOf(e)||(r[t]=r[t]||[],r[t].push(e));}function T(t,e,r){if(r&&r[t]){var n=r[t].indexOf(e);-1!==n&&r[t].splice(n,1);}}var E=function(t,e){void 0===e&&(e={}),c(this,e),this.type=t;},F=function(t){function e(e,r){void 0===r&&(r={}),t.call(this,"error",c({error:e},r));}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e}(E),O=function(){};O.prototype.on=function(t,e){return this._listeners=this._listeners||{},C(t,e,this._listeners),this},O.prototype.off=function(t,e){return T(t,e,this._listeners),T(t,e,this._oneTimeListeners),this},O.prototype.once=function(t,e){return this._oneTimeListeners=this._oneTimeListeners||{},C(t,e,this._oneTimeListeners),this},O.prototype.fire=function(t){"string"==typeof t&&(t=new E(t,arguments[1]||{}));var e=t.type;if(this.listens(e)){t.target=this;for(var r=0,n=this._listeners&&this._listeners[e]?this._listeners[e].slice():[];r<n.length;r+=1){n[r].call(this,t);}for(var i=0,a=this._oneTimeListeners&&this._oneTimeListeners[e]?this._oneTimeListeners[e].slice():[];i<a.length;i+=1){var o=a[i];T(e,o,this._oneTimeListeners),o.call(this,t);}var s=this._eventedParent;s&&(c(t,"function"==typeof this._eventedParentData?this._eventedParentData():this._eventedParentData),s.fire(t));}else t instanceof F&&console.error(t.error);return this},O.prototype.listens=function(t){return this._listeners&&this._listeners[t]&&this._listeners[t].length>0||this._oneTimeListeners&&this._oneTimeListeners[t]&&this._oneTimeListeners[t].length>0||this._eventedParent&&this._eventedParent.listens(t)},O.prototype.setEventedParent=function(t,e){return this._eventedParent=t,this._eventedParentData=e,this};var L={$version:8,$root:{version:{required:!0,type:"enum",values:[8]},name:{type:"string"},metadata:{type:"*"},center:{type:"array",value:"number"},zoom:{type:"number"},bearing:{type:"number",default:0,period:360,units:"degrees"},pitch:{type:"number",default:0,units:"degrees"},light:{type:"light"},sources:{required:!0,type:"sources"},sprite:{type:"string"},glyphs:{type:"string"},transition:{type:"transition"},layers:{required:!0,type:"array",value:"layer"}},sources:{"*":{type:"source"}},source:["source_vector","source_raster","source_raster_dem","source_geojson","source_video","source_image"],source_vector:{type:{required:!0,type:"enum",values:{vector:{}}},url:{type:"string"},tiles:{type:"array",value:"string"},bounds:{type:"array",value:"number",length:4,default:[-180,-85.051129,180,85.051129]},scheme:{type:"enum",values:{xyz:{},tms:{}},default:"xyz"},minzoom:{type:"number",default:0},maxzoom:{type:"number",default:22},attribution:{type:"string"},"*":{type:"*"}},source_raster:{type:{required:!0,type:"enum",values:{raster:{}}},url:{type:"string"},tiles:{type:"array",value:"string"},bounds:{type:"array",value:"number",length:4,default:[-180,-85.051129,180,85.051129]},minzoom:{type:"number",default:0},maxzoom:{type:"number",default:22},tileSize:{type:"number",default:512,units:"pixels"},scheme:{type:"enum",values:{xyz:{},tms:{}},default:"xyz"},attribution:{type:"string"},"*":{type:"*"}},source_raster_dem:{type:{required:!0,type:"enum",values:{"raster-dem":{}}},url:{type:"string"},tiles:{type:"array",value:"string"},bounds:{type:"array",value:"number",length:4,default:[-180,-85.051129,180,85.051129]},minzoom:{type:"number",default:0},maxzoom:{type:"number",default:22},tileSize:{type:"number",default:512,units:"pixels"},attribution:{type:"string"},encoding:{type:"enum",values:{terrarium:{},mapbox:{}},default:"mapbox"},"*":{type:"*"}},source_geojson:{type:{required:!0,type:"enum",values:{geojson:{}}},data:{type:"*"},maxzoom:{type:"number",default:18},attribution:{type:"string"},buffer:{type:"number",default:128,maximum:512,minimum:0},tolerance:{type:"number",default:.375},cluster:{type:"boolean",default:!1},clusterRadius:{type:"number",default:50,minimum:0},clusterMaxZoom:{type:"number"},lineMetrics:{type:"boolean",default:!1},generateId:{type:"boolean",default:!1}},source_video:{type:{required:!0,type:"enum",values:{video:{}}},urls:{required:!0,type:"array",value:"string"},coordinates:{required:!0,type:"array",length:4,value:{type:"array",length:2,value:"number"}}},source_image:{type:{required:!0,type:"enum",values:{image:{}}},url:{required:!0,type:"string"},coordinates:{required:!0,type:"array",length:4,value:{type:"array",length:2,value:"number"}}},layer:{id:{type:"string",required:!0},type:{type:"enum",values:{fill:{},line:{},symbol:{},circle:{},heatmap:{},"fill-extrusion":{},raster:{},hillshade:{},background:{}},required:!0},metadata:{type:"*"},source:{type:"string"},"source-layer":{type:"string"},minzoom:{type:"number",minimum:0,maximum:24},maxzoom:{type:"number",minimum:0,maximum:24},filter:{type:"filter"},layout:{type:"layout"},paint:{type:"paint"}},layout:["layout_fill","layout_line","layout_circle","layout_heatmap","layout_fill-extrusion","layout_symbol","layout_raster","layout_hillshade","layout_background"],layout_background:{visibility:{type:"enum",values:{visible:{},none:{}},default:"visible","property-type":"constant"}},layout_fill:{visibility:{type:"enum",values:{visible:{},none:{}},default:"visible","property-type":"constant"}},layout_circle:{visibility:{type:"enum",values:{visible:{},none:{}},default:"visible","property-type":"constant"}},layout_heatmap:{visibility:{type:"enum",values:{visible:{},none:{}},default:"visible","property-type":"constant"}},layout_line:{"line-cap":{type:"enum",values:{butt:{},round:{},square:{}},default:"butt",expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"line-join":{type:"enum",values:{bevel:{},round:{},miter:{}},default:"miter",expression:{interpolated:!1,parameters:["zoom","feature"]},"property-type":"data-driven"},"line-miter-limit":{type:"number",default:2,requires:[{"line-join":"miter"}],expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"line-round-limit":{type:"number",default:1.05,requires:[{"line-join":"round"}],expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},visibility:{type:"enum",values:{visible:{},none:{}},default:"visible","property-type":"constant"}},layout_symbol:{"symbol-placement":{type:"enum",values:{point:{},line:{},"line-center":{}},default:"point",expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"symbol-spacing":{type:"number",default:250,minimum:1,units:"pixels",requires:[{"symbol-placement":"line"}],expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"symbol-avoid-edges":{type:"boolean",default:!1,expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"symbol-z-order":{type:"enum",values:{"viewport-y":{},source:{}},default:"viewport-y",expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"icon-allow-overlap":{type:"boolean",default:!1,requires:["icon-image"],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"icon-ignore-placement":{type:"boolean",default:!1,requires:["icon-image"],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"icon-optional":{type:"boolean",default:!1,requires:["icon-image","text-field"],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"icon-rotation-alignment":{type:"enum",values:{map:{},viewport:{},auto:{}},default:"auto",requires:["icon-image"],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"icon-size":{type:"number",default:1,minimum:0,units:"factor of the original icon size",requires:["icon-image"],expression:{interpolated:!0,parameters:["zoom","feature"]},"property-type":"data-driven"},"icon-text-fit":{type:"enum",values:{none:{},width:{},height:{},both:{}},default:"none",requires:["icon-image","text-field"],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"icon-text-fit-padding":{type:"array",value:"number",length:4,default:[0,0,0,0],units:"pixels",requires:["icon-image","text-field",{"icon-text-fit":["both","width","height"]}],expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"icon-image":{type:"string",tokens:!0,expression:{interpolated:!1,parameters:["zoom","feature"]},"property-type":"data-driven"},"icon-rotate":{type:"number",default:0,period:360,units:"degrees",requires:["icon-image"],expression:{interpolated:!0,parameters:["zoom","feature"]},"property-type":"data-driven"},"icon-padding":{type:"number",default:2,minimum:0,units:"pixels",requires:["icon-image"],expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"icon-keep-upright":{type:"boolean",default:!1,requires:["icon-image",{"icon-rotation-alignment":"map"},{"symbol-placement":["line","line-center"]}],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"icon-offset":{type:"array",value:"number",length:2,default:[0,0],requires:["icon-image"],expression:{interpolated:!0,parameters:["zoom","feature"]},"property-type":"data-driven"},"icon-anchor":{type:"enum",values:{center:{},left:{},right:{},top:{},bottom:{},"top-left":{},"top-right":{},"bottom-left":{},"bottom-right":{}},default:"center",requires:["icon-image"],expression:{interpolated:!1,parameters:["zoom","feature"]},"property-type":"data-driven"},"icon-pitch-alignment":{type:"enum",values:{map:{},viewport:{},auto:{}},default:"auto",requires:["icon-image"],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"text-pitch-alignment":{type:"enum",values:{map:{},viewport:{},auto:{}},default:"auto",requires:["text-field"],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"text-rotation-alignment":{type:"enum",values:{map:{},viewport:{},auto:{}},default:"auto",requires:["text-field"],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"text-field":{type:"formatted",default:"",tokens:!0,expression:{interpolated:!1,parameters:["zoom","feature"]},"property-type":"data-driven"},"text-font":{type:"array",value:"string",default:["Open Sans Regular","Arial Unicode MS Regular"],requires:["text-field"],expression:{interpolated:!1,parameters:["zoom","feature"]},"property-type":"data-driven"},"text-size":{type:"number",default:16,minimum:0,units:"pixels",requires:["text-field"],expression:{interpolated:!0,parameters:["zoom","feature"]},"property-type":"data-driven"},"text-max-width":{type:"number",default:10,minimum:0,units:"ems",requires:["text-field"],expression:{interpolated:!0,parameters:["zoom","feature"]},"property-type":"data-driven"},"text-line-height":{type:"number",default:1.2,units:"ems",requires:["text-field"],expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"text-letter-spacing":{type:"number",default:0,units:"ems",requires:["text-field"],expression:{interpolated:!0,parameters:["zoom","feature"]},"property-type":"data-driven"},"text-justify":{type:"enum",values:{left:{},center:{},right:{}},default:"center",requires:["text-field"],expression:{interpolated:!1,parameters:["zoom","feature"]},"property-type":"data-driven"},"text-anchor":{type:"enum",values:{center:{},left:{},right:{},top:{},bottom:{},"top-left":{},"top-right":{},"bottom-left":{},"bottom-right":{}},default:"center",requires:["text-field"],expression:{interpolated:!1,parameters:["zoom","feature"]},"property-type":"data-driven"},"text-max-angle":{type:"number",default:45,units:"degrees",requires:["text-field",{"symbol-placement":["line","line-center"]}],expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"text-rotate":{type:"number",default:0,period:360,units:"degrees",requires:["text-field"],expression:{interpolated:!0,parameters:["zoom","feature"]},"property-type":"data-driven"},"text-padding":{type:"number",default:2,minimum:0,units:"pixels",requires:["text-field"],expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"text-keep-upright":{type:"boolean",default:!0,requires:["text-field",{"text-rotation-alignment":"map"},{"symbol-placement":["line","line-center"]}],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"text-transform":{type:"enum",values:{none:{},uppercase:{},lowercase:{}},default:"none",requires:["text-field"],expression:{interpolated:!1,parameters:["zoom","feature"]},"property-type":"data-driven"},"text-offset":{type:"array",value:"number",units:"ems",length:2,default:[0,0],requires:["text-field"],expression:{interpolated:!0,parameters:["zoom","feature"]},"property-type":"data-driven"},"text-allow-overlap":{type:"boolean",default:!1,requires:["text-field"],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"text-ignore-placement":{type:"boolean",default:!1,requires:["text-field"],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"text-optional":{type:"boolean",default:!1,requires:["text-field","icon-image"],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},visibility:{type:"enum",values:{visible:{},none:{}},default:"visible","property-type":"constant"}},layout_raster:{visibility:{type:"enum",values:{visible:{},none:{}},default:"visible","property-type":"constant"}},layout_hillshade:{visibility:{type:"enum",values:{visible:{},none:{}},default:"visible","property-type":"constant"}},filter:{type:"array",value:"*"},filter_operator:{type:"enum",values:{"==":{},"!=":{},">":{},">=":{},"<":{},"<=":{},in:{},"!in":{},all:{},any:{},none:{},has:{},"!has":{}}},geometry_type:{type:"enum",values:{Point:{},LineString:{},Polygon:{}}},function_stop:{type:"array",minimum:0,maximum:22,value:["number","color"],length:2},expression:{type:"array",value:"*",minimum:1},expression_name:{type:"enum",values:{let:{group:"Variable binding"},var:{group:"Variable binding"},literal:{group:"Types"},array:{group:"Types"},at:{group:"Lookup"},case:{group:"Decision"},match:{group:"Decision"},coalesce:{group:"Decision"},step:{group:"Ramps, scales, curves"},interpolate:{group:"Ramps, scales, curves"},"interpolate-hcl":{group:"Ramps, scales, curves"},"interpolate-lab":{group:"Ramps, scales, curves"},ln2:{group:"Math"},pi:{group:"Math"},e:{group:"Math"},typeof:{group:"Types"},string:{group:"Types"},number:{group:"Types"},boolean:{group:"Types"},object:{group:"Types"},collator:{group:"Types"},format:{group:"Types"},"to-string":{group:"Types"},"to-number":{group:"Types"},"to-boolean":{group:"Types"},"to-rgba":{group:"Color"},"to-color":{group:"Types"},rgb:{group:"Color"},rgba:{group:"Color"},get:{group:"Lookup"},has:{group:"Lookup"},length:{group:"Lookup"},properties:{group:"Feature data"},"feature-state":{group:"Feature data"},"geometry-type":{group:"Feature data"},id:{group:"Feature data"},zoom:{group:"Zoom"},"heatmap-density":{group:"Heatmap"},"line-progress":{group:"Heatmap"},"+":{group:"Math"},"*":{group:"Math"},"-":{group:"Math"},"/":{group:"Math"},"%":{group:"Math"},"^":{group:"Math"},sqrt:{group:"Math"},log10:{group:"Math"},ln:{group:"Math"},log2:{group:"Math"},sin:{group:"Math"},cos:{group:"Math"},tan:{group:"Math"},asin:{group:"Math"},acos:{group:"Math"},atan:{group:"Math"},min:{group:"Math"},max:{group:"Math"},round:{group:"Math"},abs:{group:"Math"},ceil:{group:"Math"},floor:{group:"Math"},"==":{group:"Decision"},"!=":{group:"Decision"},">":{group:"Decision"},"<":{group:"Decision"},">=":{group:"Decision"},"<=":{group:"Decision"},all:{group:"Decision"},any:{group:"Decision"},"!":{group:"Decision"},"is-supported-script":{group:"String"},upcase:{group:"String"},downcase:{group:"String"},concat:{group:"String"},"resolved-locale":{group:"String"}}},light:{anchor:{type:"enum",default:"viewport",values:{map:{},viewport:{}},"property-type":"data-constant",transition:!1,expression:{interpolated:!1,parameters:["zoom"]}},position:{type:"array",default:[1.15,210,30],length:3,value:"number","property-type":"data-constant",transition:!0,expression:{interpolated:!0,parameters:["zoom"]}},color:{type:"color","property-type":"data-constant",default:"#ffffff",expression:{interpolated:!0,parameters:["zoom"]},transition:!0},intensity:{type:"number","property-type":"data-constant",default:.5,minimum:0,maximum:1,expression:{interpolated:!0,parameters:["zoom"]},transition:!0}},paint:["paint_fill","paint_line","paint_circle","paint_heatmap","paint_fill-extrusion","paint_symbol","paint_raster","paint_hillshade","paint_background"],paint_fill:{"fill-antialias":{type:"boolean",default:!0,expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"fill-opacity":{type:"number",default:1,minimum:0,maximum:1,transition:!0,expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"fill-color":{type:"color",default:"#000000",transition:!0,requires:[{"!":"fill-pattern"}],expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"fill-outline-color":{type:"color",transition:!0,requires:[{"!":"fill-pattern"},{"fill-antialias":!0}],expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"fill-translate":{type:"array",value:"number",length:2,default:[0,0],transition:!0,units:"pixels",expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"fill-translate-anchor":{type:"enum",values:{map:{},viewport:{}},default:"map",requires:["fill-translate"],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"fill-pattern":{type:"string",transition:!0,expression:{interpolated:!1,parameters:["zoom","feature"]},"property-type":"cross-faded-data-driven"}},paint_line:{"line-opacity":{type:"number",default:1,minimum:0,maximum:1,transition:!0,expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"line-color":{type:"color",default:"#000000",transition:!0,requires:[{"!":"line-pattern"}],expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"line-translate":{type:"array",value:"number",length:2,default:[0,0],transition:!0,units:"pixels",expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"line-translate-anchor":{type:"enum",values:{map:{},viewport:{}},default:"map",requires:["line-translate"],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"line-width":{type:"number",default:1,minimum:0,transition:!0,units:"pixels",expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"line-gap-width":{type:"number",default:0,minimum:0,transition:!0,units:"pixels",expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"line-offset":{type:"number",default:0,transition:!0,units:"pixels",expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"line-blur":{type:"number",default:0,minimum:0,transition:!0,units:"pixels",expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"line-dasharray":{type:"array",value:"number",minimum:0,transition:!0,units:"line widths",requires:[{"!":"line-pattern"}],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"cross-faded"},"line-pattern":{type:"string",transition:!0,expression:{interpolated:!1,parameters:["zoom","feature"]},"property-type":"cross-faded-data-driven"},"line-gradient":{type:"color",transition:!1,requires:[{"!":"line-dasharray"},{"!":"line-pattern"},{source:"geojson",has:{lineMetrics:!0}}],expression:{interpolated:!0,parameters:["line-progress"]},"property-type":"color-ramp"}},paint_circle:{"circle-radius":{type:"number",default:5,minimum:0,transition:!0,units:"pixels",expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"circle-color":{type:"color",default:"#000000",transition:!0,expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"circle-blur":{type:"number",default:0,transition:!0,expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"circle-opacity":{type:"number",default:1,minimum:0,maximum:1,transition:!0,expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"circle-translate":{type:"array",value:"number",length:2,default:[0,0],transition:!0,units:"pixels",expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"circle-translate-anchor":{type:"enum",values:{map:{},viewport:{}},default:"map",requires:["circle-translate"],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"circle-pitch-scale":{type:"enum",values:{map:{},viewport:{}},default:"map",expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"circle-pitch-alignment":{type:"enum",values:{map:{},viewport:{}},default:"viewport",expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"circle-stroke-width":{type:"number",default:0,minimum:0,transition:!0,units:"pixels",expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"circle-stroke-color":{type:"color",default:"#000000",transition:!0,expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"circle-stroke-opacity":{type:"number",default:1,minimum:0,maximum:1,transition:!0,expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"}},paint_heatmap:{"heatmap-radius":{type:"number",default:30,minimum:1,transition:!0,units:"pixels",expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"heatmap-weight":{type:"number",default:1,minimum:0,transition:!1,expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"heatmap-intensity":{type:"number",default:1,minimum:0,transition:!0,expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"heatmap-color":{type:"color",default:["interpolate",["linear"],["heatmap-density"],0,"rgba(0, 0, 255, 0)",.1,"royalblue",.3,"cyan",.5,"lime",.7,"yellow",1,"red"],transition:!1,expression:{interpolated:!0,parameters:["heatmap-density"]},"property-type":"color-ramp"},"heatmap-opacity":{type:"number",default:1,minimum:0,maximum:1,transition:!0,expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"}},paint_symbol:{"icon-opacity":{type:"number",default:1,minimum:0,maximum:1,transition:!0,requires:["icon-image"],expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"icon-color":{type:"color",default:"#000000",transition:!0,requires:["icon-image"],expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"icon-halo-color":{type:"color",default:"rgba(0, 0, 0, 0)",transition:!0,requires:["icon-image"],expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"icon-halo-width":{type:"number",default:0,minimum:0,transition:!0,units:"pixels",requires:["icon-image"],expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"icon-halo-blur":{type:"number",default:0,minimum:0,transition:!0,units:"pixels",requires:["icon-image"],expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"icon-translate":{type:"array",value:"number",length:2,default:[0,0],transition:!0,units:"pixels",requires:["icon-image"],expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"icon-translate-anchor":{type:"enum",values:{map:{},viewport:{}},default:"map",requires:["icon-image","icon-translate"],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"text-opacity":{type:"number",default:1,minimum:0,maximum:1,transition:!0,requires:["text-field"],expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"text-color":{type:"color",default:"#000000",transition:!0,requires:["text-field"],expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"text-halo-color":{type:"color",default:"rgba(0, 0, 0, 0)",transition:!0,requires:["text-field"],expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"text-halo-width":{type:"number",default:0,minimum:0,transition:!0,units:"pixels",requires:["text-field"],expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"text-halo-blur":{type:"number",default:0,minimum:0,transition:!0,units:"pixels",requires:["text-field"],expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"text-translate":{type:"array",value:"number",length:2,default:[0,0],transition:!0,units:"pixels",requires:["text-field"],expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"text-translate-anchor":{type:"enum",values:{map:{},viewport:{}},default:"map",requires:["text-field","text-translate"],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"}},paint_raster:{"raster-opacity":{type:"number",default:1,minimum:0,maximum:1,transition:!0,expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"raster-hue-rotate":{type:"number",default:0,period:360,transition:!0,units:"degrees",expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"raster-brightness-min":{type:"number",default:0,minimum:0,maximum:1,transition:!0,expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"raster-brightness-max":{type:"number",default:1,minimum:0,maximum:1,transition:!0,expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"raster-saturation":{type:"number",default:0,minimum:-1,maximum:1,transition:!0,expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"raster-contrast":{type:"number",default:0,minimum:-1,maximum:1,transition:!0,expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"raster-resampling":{type:"enum",values:{linear:{},nearest:{}},default:"linear",expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"raster-fade-duration":{type:"number",default:300,minimum:0,transition:!1,units:"milliseconds",expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"}},paint_hillshade:{"hillshade-illumination-direction":{type:"number",default:335,minimum:0,maximum:359,transition:!1,expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"hillshade-illumination-anchor":{type:"enum",values:{map:{},viewport:{}},default:"viewport",expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"hillshade-exaggeration":{type:"number",default:.5,minimum:0,maximum:1,transition:!0,expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"hillshade-shadow-color":{type:"color",default:"#000000",transition:!0,expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"hillshade-highlight-color":{type:"color",default:"#FFFFFF",transition:!0,expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"hillshade-accent-color":{type:"color",default:"#000000",transition:!0,expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"}},paint_background:{"background-color":{type:"color",default:"#000000",transition:!0,requires:[{"!":"background-pattern"}],expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"background-pattern":{type:"string",transition:!0,expression:{interpolated:!1,parameters:["zoom"]},"property-type":"cross-faded"},"background-opacity":{type:"number",default:1,minimum:0,maximum:1,transition:!0,expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"}},transition:{duration:{type:"number",default:300,minimum:0,units:"milliseconds"},delay:{type:"number",default:0,minimum:0,units:"milliseconds"}},"layout_fill-extrusion":{visibility:{type:"enum",values:{visible:{},none:{}},default:"visible","property-type":"constant"}},function:{expression:{type:"expression"},stops:{type:"array",value:"function_stop"},base:{type:"number",default:1,minimum:0},property:{type:"string",default:"$zoom"},type:{type:"enum",values:{identity:{},exponential:{},interval:{},categorical:{}},default:"exponential"},colorSpace:{type:"enum",values:{rgb:{},lab:{},hcl:{}},default:"rgb"},default:{type:"*",required:!1}},"paint_fill-extrusion":{"fill-extrusion-opacity":{type:"number",default:1,minimum:0,maximum:1,transition:!0,expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"fill-extrusion-color":{type:"color",default:"#000000",transition:!0,requires:[{"!":"fill-extrusion-pattern"}],expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"fill-extrusion-translate":{type:"array",value:"number",length:2,default:[0,0],transition:!0,units:"pixels",expression:{interpolated:!0,parameters:["zoom"]},"property-type":"data-constant"},"fill-extrusion-translate-anchor":{type:"enum",values:{map:{},viewport:{}},default:"map",requires:["fill-extrusion-translate"],expression:{interpolated:!1,parameters:["zoom"]},"property-type":"data-constant"},"fill-extrusion-pattern":{type:"string",transition:!0,expression:{interpolated:!1,parameters:["zoom","feature"]},"property-type":"cross-faded-data-driven"},"fill-extrusion-height":{type:"number",default:0,minimum:0,units:"meters",transition:!0,expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"},"fill-extrusion-base":{type:"number",default:0,minimum:0,units:"meters",transition:!0,requires:["fill-extrusion-height"],expression:{interpolated:!0,parameters:["zoom","feature","feature-state"]},"property-type":"data-driven"}},"property-type":{"data-driven":{type:"property-type"},"cross-faded":{type:"property-type"},"cross-faded-data-driven":{type:"property-type"},"color-ramp":{type:"property-type"},"data-constant":{type:"property-type"},constant:{type:"property-type"}}},D=function(t,e,r,n){this.message=(t?t+": ":"")+r,n&&(this.identifier=n),null!=e&&e.__line__&&(this.line=e.__line__);};function j(t){var e=t.key,r=t.value;return r?[new D(e,r,"constants have been deprecated as of v8")]:[]}function U(t){for(var e=[],r=arguments.length-1;r-- >0;)e[r]=arguments[r+1];for(var n=0,i=e;n<i.length;n+=1){var a=i[n];for(var o in a)t[o]=a[o];}return t}function q(t){return t instanceof Number||t instanceof String||t instanceof Boolean?t.valueOf():t}function R(t){return Array.isArray(t)?t.map(R):q(t)}var N=function(t){function e(e,r){t.call(this,r),this.message=r,this.key=e;}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e}(Error),Z=function(t,e){void 0===e&&(e=[]),this.parent=t,this.bindings={};for(var r=0,n=e;r<n.length;r+=1){var i=n[r],a=i[0],o=i[1];this.bindings[a]=o;}};Z.prototype.concat=function(t){return new Z(this,t)},Z.prototype.get=function(t){if(this.bindings[t])return this.bindings[t];if(this.parent)return this.parent.get(t);throw new Error(t+" not found in scope.")},Z.prototype.has=function(t){return !!this.bindings[t]||!!this.parent&&this.parent.has(t)};var X={kind:"null"},H={kind:"number"},G={kind:"string"},J={kind:"boolean"},K={kind:"color"},Y={kind:"object"},$={kind:"value"},W={kind:"collator"},Q={kind:"formatted"};function tt(t,e){return {kind:"array",itemType:t,N:e}}function et(t){if("array"===t.kind){var e=et(t.itemType);return "number"==typeof t.N?"array<"+e+", "+t.N+">":"value"===t.itemType.kind?"array":"array<"+e+">"}return t.kind}var rt=[X,H,G,J,K,Q,Y,tt($)];function nt(t,e){if("error"===e.kind)return null;if("array"===t.kind){if("array"===e.kind&&!nt(t.itemType,e.itemType)&&("number"!=typeof t.N||t.N===e.N))return null}else{if(t.kind===e.kind)return null;if("value"===t.kind)for(var r=0,n=rt;r<n.length;r+=1){if(!nt(n[r],e))return null}}return "Expected "+et(t)+" but found "+et(e)+" instead."}var it=e(function(t,e){var r={transparent:[0,0,0,0],aliceblue:[240,248,255,1],antiquewhite:[250,235,215,1],aqua:[0,255,255,1],aquamarine:[127,255,212,1],azure:[240,255,255,1],beige:[245,245,220,1],bisque:[255,228,196,1],black:[0,0,0,1],blanchedalmond:[255,235,205,1],blue:[0,0,255,1],blueviolet:[138,43,226,1],brown:[165,42,42,1],burlywood:[222,184,135,1],cadetblue:[95,158,160,1],chartreuse:[127,255,0,1],chocolate:[210,105,30,1],coral:[255,127,80,1],cornflowerblue:[100,149,237,1],cornsilk:[255,248,220,1],crimson:[220,20,60,1],cyan:[0,255,255,1],darkblue:[0,0,139,1],darkcyan:[0,139,139,1],darkgoldenrod:[184,134,11,1],darkgray:[169,169,169,1],darkgreen:[0,100,0,1],darkgrey:[169,169,169,1],darkkhaki:[189,183,107,1],darkmagenta:[139,0,139,1],darkolivegreen:[85,107,47,1],darkorange:[255,140,0,1],darkorchid:[153,50,204,1],darkred:[139,0,0,1],darksalmon:[233,150,122,1],darkseagreen:[143,188,143,1],darkslateblue:[72,61,139,1],darkslategray:[47,79,79,1],darkslategrey:[47,79,79,1],darkturquoise:[0,206,209,1],darkviolet:[148,0,211,1],deeppink:[255,20,147,1],deepskyblue:[0,191,255,1],dimgray:[105,105,105,1],dimgrey:[105,105,105,1],dodgerblue:[30,144,255,1],firebrick:[178,34,34,1],floralwhite:[255,250,240,1],forestgreen:[34,139,34,1],fuchsia:[255,0,255,1],gainsboro:[220,220,220,1],ghostwhite:[248,248,255,1],gold:[255,215,0,1],goldenrod:[218,165,32,1],gray:[128,128,128,1],green:[0,128,0,1],greenyellow:[173,255,47,1],grey:[128,128,128,1],honeydew:[240,255,240,1],hotpink:[255,105,180,1],indianred:[205,92,92,1],indigo:[75,0,130,1],ivory:[255,255,240,1],khaki:[240,230,140,1],lavender:[230,230,250,1],lavenderblush:[255,240,245,1],lawngreen:[124,252,0,1],lemonchiffon:[255,250,205,1],lightblue:[173,216,230,1],lightcoral:[240,128,128,1],lightcyan:[224,255,255,1],lightgoldenrodyellow:[250,250,210,1],lightgray:[211,211,211,1],lightgreen:[144,238,144,1],lightgrey:[211,211,211,1],lightpink:[255,182,193,1],lightsalmon:[255,160,122,1],lightseagreen:[32,178,170,1],lightskyblue:[135,206,250,1],lightslategray:[119,136,153,1],lightslategrey:[119,136,153,1],lightsteelblue:[176,196,222,1],lightyellow:[255,255,224,1],lime:[0,255,0,1],limegreen:[50,205,50,1],linen:[250,240,230,1],magenta:[255,0,255,1],maroon:[128,0,0,1],mediumaquamarine:[102,205,170,1],mediumblue:[0,0,205,1],mediumorchid:[186,85,211,1],mediumpurple:[147,112,219,1],mediumseagreen:[60,179,113,1],mediumslateblue:[123,104,238,1],mediumspringgreen:[0,250,154,1],mediumturquoise:[72,209,204,1],mediumvioletred:[199,21,133,1],midnightblue:[25,25,112,1],mintcream:[245,255,250,1],mistyrose:[255,228,225,1],moccasin:[255,228,181,1],navajowhite:[255,222,173,1],navy:[0,0,128,1],oldlace:[253,245,230,1],olive:[128,128,0,1],olivedrab:[107,142,35,1],orange:[255,165,0,1],orangered:[255,69,0,1],orchid:[218,112,214,1],palegoldenrod:[238,232,170,1],palegreen:[152,251,152,1],paleturquoise:[175,238,238,1],palevioletred:[219,112,147,1],papayawhip:[255,239,213,1],peachpuff:[255,218,185,1],peru:[205,133,63,1],pink:[255,192,203,1],plum:[221,160,221,1],powderblue:[176,224,230,1],purple:[128,0,128,1],rebeccapurple:[102,51,153,1],red:[255,0,0,1],rosybrown:[188,143,143,1],royalblue:[65,105,225,1],saddlebrown:[139,69,19,1],salmon:[250,128,114,1],sandybrown:[244,164,96,1],seagreen:[46,139,87,1],seashell:[255,245,238,1],sienna:[160,82,45,1],silver:[192,192,192,1],skyblue:[135,206,235,1],slateblue:[106,90,205,1],slategray:[112,128,144,1],slategrey:[112,128,144,1],snow:[255,250,250,1],springgreen:[0,255,127,1],steelblue:[70,130,180,1],tan:[210,180,140,1],teal:[0,128,128,1],thistle:[216,191,216,1],tomato:[255,99,71,1],turquoise:[64,224,208,1],violet:[238,130,238,1],wheat:[245,222,179,1],white:[255,255,255,1],whitesmoke:[245,245,245,1],yellow:[255,255,0,1],yellowgreen:[154,205,50,1]};function n(t){return (t=Math.round(t))<0?0:t>255?255:t}function i(t){return t<0?0:t>1?1:t}function a(t){return "%"===t[t.length-1]?n(parseFloat(t)/100*255):n(parseInt(t))}function o(t){return "%"===t[t.length-1]?i(parseFloat(t)/100):i(parseFloat(t))}function s(t,e,r){return r<0?r+=1:r>1&&(r-=1),6*r<1?t+(e-t)*r*6:2*r<1?e:3*r<2?t+(e-t)*(2/3-r)*6:t}try{e.parseCSSColor=function(t){var e,i=t.replace(/ /g,"").toLowerCase();if(i in r)return r[i].slice();if("#"===i[0])return 4===i.length?(e=parseInt(i.substr(1),16))>=0&&e<=4095?[(3840&e)>>4|(3840&e)>>8,240&e|(240&e)>>4,15&e|(15&e)<<4,1]:null:7===i.length&&(e=parseInt(i.substr(1),16))>=0&&e<=16777215?[(16711680&e)>>16,(65280&e)>>8,255&e,1]:null;var u=i.indexOf("("),p=i.indexOf(")");if(-1!==u&&p+1===i.length){var l=i.substr(0,u),c=i.substr(u+1,p-(u+1)).split(","),h=1;switch(l){case"rgba":if(4!==c.length)return null;h=o(c.pop());case"rgb":return 3!==c.length?null:[a(c[0]),a(c[1]),a(c[2]),h];case"hsla":if(4!==c.length)return null;h=o(c.pop());case"hsl":if(3!==c.length)return null;var f=(parseFloat(c[0])%360+360)%360/360,y=o(c[1]),d=o(c[2]),m=d<=.5?d*(y+1):d+y-d*y,v=2*d-m;return [n(255*s(v,m,f+1/3)),n(255*s(v,m,f)),n(255*s(v,m,f-1/3)),h];default:return null}}return null};}catch(t){}}).parseCSSColor,at=function(t,e,r,n){void 0===n&&(n=1),this.r=t,this.g=e,this.b=r,this.a=n;};at.parse=function(t){if(t){if(t instanceof at)return t;if("string"==typeof t){var e=it(t);if(e)return new at(e[0]/255*e[3],e[1]/255*e[3],e[2]/255*e[3],e[3])}}},at.prototype.toString=function(){var t=this.toArray(),e=t[0],r=t[1],n=t[2],i=t[3];return "rgba("+Math.round(e)+","+Math.round(r)+","+Math.round(n)+","+i+")"},at.prototype.toArray=function(){var t=this.r,e=this.g,r=this.b,n=this.a;return 0===n?[0,0,0,0]:[255*t/n,255*e/n,255*r/n,n]},at.black=new at(0,0,0,1),at.white=new at(1,1,1,1),at.transparent=new at(0,0,0,0),at.red=new at(1,0,0,1);var ot=function(t,e,r){this.sensitivity=t?e?"variant":"case":e?"accent":"base",this.locale=r,this.collator=new Intl.Collator(this.locale?this.locale:[],{sensitivity:this.sensitivity,usage:"search"});};ot.prototype.compare=function(t,e){return this.collator.compare(t,e)},ot.prototype.resolvedLocale=function(){return new Intl.Collator(this.locale?this.locale:[]).resolvedOptions().locale};var st=function(t,e,r){this.type=W,this.locale=r,this.caseSensitive=t,this.diacriticSensitive=e;};function ut(t,e,r,n){return "number"==typeof t&&t>=0&&t<=255&&"number"==typeof e&&e>=0&&e<=255&&"number"==typeof r&&r>=0&&r<=255?void 0===n||"number"==typeof n&&n>=0&&n<=1?null:"Invalid rgba value ["+[t,e,r,n].join(", ")+"]: 'a' must be between 0 and 1.":"Invalid rgba value ["+("number"==typeof n?[t,e,r,n]:[t,e,r]).join(", ")+"]: 'r', 'g', and 'b' must be between 0 and 255."}function pt(t){if(null===t)return X;if("string"==typeof t)return G;if("boolean"==typeof t)return J;if("number"==typeof t)return H;if(t instanceof at)return K;if(t instanceof ot)return W;if(Array.isArray(t)){for(var e,r=t.length,n=0,i=t;n<i.length;n+=1){var a=pt(i[n]);if(e){if(e===a)continue;e=$;break}e=a;}return tt(e||$,r)}return Y}st.parse=function(t,e){if(2!==t.length)return e.error("Expected one argument.");var r=t[1];if("object"!=typeof r||Array.isArray(r))return e.error("Collator options argument must be an object.");var n=e.parse(void 0!==r["case-sensitive"]&&r["case-sensitive"],1,J);if(!n)return null;var i=e.parse(void 0!==r["diacritic-sensitive"]&&r["diacritic-sensitive"],1,J);if(!i)return null;var a=null;return r.locale&&!(a=e.parse(r.locale,1,G))?null:new st(n,i,a)},st.prototype.evaluate=function(t){return new ot(this.caseSensitive.evaluate(t),this.diacriticSensitive.evaluate(t),this.locale?this.locale.evaluate(t):null)},st.prototype.eachChild=function(t){t(this.caseSensitive),t(this.diacriticSensitive),this.locale&&t(this.locale);},st.prototype.possibleOutputs=function(){return [void 0]},st.prototype.serialize=function(){var t={};return t["case-sensitive"]=this.caseSensitive.serialize(),t["diacritic-sensitive"]=this.diacriticSensitive.serialize(),this.locale&&(t.locale=this.locale.serialize()),["collator",t]};var lt=function(t,e,r){this.text=t,this.scale=e,this.fontStack=r;},ct=function(t){this.sections=t;};ct.prototype.toString=function(){return this.sections.map(function(t){return t.text}).join("")},ct.prototype.serialize=function(){for(var t=["format"],e=0,r=this.sections;e<r.length;e+=1){var n=r[e];t.push(n.text);var i=n.fontStack?["literal",n.fontStack.split(",")]:null;t.push({"text-font":i,"font-scale":n.scale});}return t};var ht=function(t){this.type=Q,this.sections=t;};ht.parse=function(t,e){if(t.length<3)return e.error("Expected at least two arguments.");if((t.length-1)%2!=0)return e.error("Expected an even number of arguments.");for(var r=[],n=1;n<t.length-1;n+=2){var i=e.parse(t[n],1,$);if(!i)return null;var a=i.type.kind;if("string"!==a&&"value"!==a&&"null"!==a)return e.error("Formatted text type must be 'string', 'value', or 'null'.");var o=t[n+1];if("object"!=typeof o||Array.isArray(o))return e.error("Format options argument must be an object.");var s=null;if(o["font-scale"]&&!(s=e.parse(o["font-scale"],1,H)))return null;var u=null;if(o["text-font"]&&!(u=e.parse(o["text-font"],1,tt(G))))return null;r.push({text:i,scale:s,font:u});}return new ht(r)},ht.prototype.evaluate=function(t){return new ct(this.sections.map(function(e){return new lt(e.text.evaluate(t)||"",e.scale?e.scale.evaluate(t):null,e.font?e.font.evaluate(t).join(","):null)}))},ht.prototype.eachChild=function(t){for(var e=0,r=this.sections;e<r.length;e+=1){var n=r[e];t(n.text),n.scale&&t(n.scale),n.font&&t(n.font);}},ht.prototype.possibleOutputs=function(){return [void 0]},ht.prototype.serialize=function(){for(var t=["format"],e=0,r=this.sections;e<r.length;e+=1){var n=r[e];t.push(n.text.serialize());var i={};n.scale&&(i["font-scale"]=n.scale.serialize()),n.font&&(i["text-font"]=n.font.serialize()),t.push(i);}return t};var ft=function(t,e){this.type=t,this.value=e;};ft.parse=function(t,e){if(2!==t.length)return e.error("'literal' expression requires exactly one argument, but found "+(t.length-1)+" instead.");if(!function t(e){if(null===e)return !0;if("string"==typeof e)return !0;if("boolean"==typeof e)return !0;if("number"==typeof e)return !0;if(e instanceof at)return !0;if(e instanceof ot)return !0;if(Array.isArray(e)){for(var r=0,n=e;r<n.length;r+=1)if(!t(n[r]))return !1;return !0}if("object"==typeof e){for(var i in e)if(!t(e[i]))return !1;return !0}return !1}(t[1]))return e.error("invalid value");var r=t[1],n=pt(r),i=e.expectedType;return "array"!==n.kind||0!==n.N||!i||"array"!==i.kind||"number"==typeof i.N&&0!==i.N||(n=i),new ft(n,r)},ft.prototype.evaluate=function(){return this.value},ft.prototype.eachChild=function(){},ft.prototype.possibleOutputs=function(){return [this.value]},ft.prototype.serialize=function(){return "array"===this.type.kind||"object"===this.type.kind?["literal",this.value]:this.value instanceof at?["rgba"].concat(this.value.toArray()):this.value instanceof ct?this.value.serialize():this.value};var yt=function(t){this.name="ExpressionEvaluationError",this.message=t;};yt.prototype.toJSON=function(){return this.message};var dt={string:G,number:H,boolean:J,object:Y},mt=function(t,e){this.type=t,this.args=e;};mt.parse=function(t,e){if(t.length<2)return e.error("Expected at least one argument.");var r,n=1,i=t[0];if("array"===i){var a,o;if(t.length>2){var s=t[1];if("string"!=typeof s||!(s in dt)||"object"===s)return e.error('The item type argument of "array" must be one of string, number, boolean',1);a=dt[s],n++;}else a=$;if(t.length>3){if(null!==t[2]&&("number"!=typeof t[2]||t[2]<0||t[2]!==Math.floor(t[2])))return e.error('The length argument to "array" must be a positive integer literal',2);o=t[2],n++;}r=tt(a,o);}else r=dt[i];for(var u=[];n<t.length;n++){var p=e.parse(t[n],n,$);if(!p)return null;u.push(p);}return new mt(r,u)},mt.prototype.evaluate=function(t){for(var e=0;e<this.args.length;e++){var r=this.args[e].evaluate(t);if(!nt(this.type,pt(r)))return r;if(e===this.args.length-1)throw new yt("Expected value to be of type "+et(this.type)+", but found "+et(pt(r))+" instead.")}return null},mt.prototype.eachChild=function(t){this.args.forEach(t);},mt.prototype.possibleOutputs=function(){return (t=[]).concat.apply(t,this.args.map(function(t){return t.possibleOutputs()}));var t;},mt.prototype.serialize=function(){var t=this.type,e=[t.kind];if("array"===t.kind){var r=t.itemType;if("string"===r.kind||"number"===r.kind||"boolean"===r.kind){e.push(r.kind);var n=t.N;("number"==typeof n||this.args.length>1)&&e.push(n);}}return e.concat(this.args.map(function(t){return t.serialize()}))};var vt={"to-number":H,"to-color":K},gt=function(t,e){this.type=t,this.args=e;};gt.parse=function(t,e){if(t.length<2)return e.error("Expected at least one argument.");for(var r=t[0],n=vt[r],i=[],a=1;a<t.length;a++){var o=e.parse(t[a],a,$);if(!o)return null;i.push(o);}return new gt(n,i)},gt.prototype.evaluate=function(t){if("color"===this.type.kind){for(var e,r,n=0,i=this.args;n<i.length;n+=1){if(r=null,"string"==typeof(e=i[n].evaluate(t))){var a=t.parseColor(e);if(a)return a}else if(Array.isArray(e)&&!(r=e.length<3||e.length>4?"Invalid rbga value "+JSON.stringify(e)+": expected an array containing either three or four numeric values.":ut(e[0],e[1],e[2],e[3])))return new at(e[0]/255,e[1]/255,e[2]/255,e[3])}throw new yt(r||"Could not parse color from value '"+("string"==typeof e?e:JSON.stringify(e))+"'")}if("formatted"===this.type.kind){for(var o,s=0,u=this.args;s<u.length;s+=1){if("string"==typeof(o=u[s].evaluate(t)))return new ct([new lt(o,null,null)])}throw new yt("Could not parse formatted text from value '"+("string"==typeof o?o:JSON.stringify(o))+"'")}for(var p=null,l=0,c=this.args;l<c.length;l+=1){if(null!==(p=c[l].evaluate(t))){var h=Number(p);if(!isNaN(h))return h}}throw new yt("Could not convert "+JSON.stringify(p)+" to number.")},gt.prototype.eachChild=function(t){this.args.forEach(t);},gt.prototype.possibleOutputs=function(){return (t=[]).concat.apply(t,this.args.map(function(t){return t.possibleOutputs()}));var t;},gt.prototype.serialize=function(){var t=["to-"+this.type.kind];return this.eachChild(function(e){t.push(e.serialize());}),t};var xt=["Unknown","Point","LineString","Polygon"],bt=function(){this._parseColorCache={};};bt.prototype.id=function(){return this.feature&&"id"in this.feature?this.feature.id:null},bt.prototype.geometryType=function(){return this.feature?"number"==typeof this.feature.type?xt[this.feature.type]:this.feature.type:null},bt.prototype.properties=function(){return this.feature&&this.feature.properties||{}},bt.prototype.parseColor=function(t){var e=this._parseColorCache[t];return e||(e=this._parseColorCache[t]=at.parse(t)),e};var _t=function(t,e,r,n){this.name=t,this.type=e,this._evaluate=r,this.args=n;};function wt(t){if(t instanceof _t){if("get"===t.name&&1===t.args.length)return !1;if("feature-state"===t.name)return !1;if("has"===t.name&&1===t.args.length)return !1;if("properties"===t.name||"geometry-type"===t.name||"id"===t.name)return !1;if(/^filter-/.test(t.name))return !1}var e=!0;return t.eachChild(function(t){e&&!wt(t)&&(e=!1);}),e}function At(t){if(t instanceof _t&&"feature-state"===t.name)return !1;var e=!0;return t.eachChild(function(t){e&&!At(t)&&(e=!1);}),e}function kt(t,e){if(t instanceof _t&&e.indexOf(t.name)>=0)return !1;var r=!0;return t.eachChild(function(t){r&&!kt(t,e)&&(r=!1);}),r}_t.prototype.evaluate=function(t){return this._evaluate(t,this.args)},_t.prototype.eachChild=function(t){this.args.forEach(t);},_t.prototype.possibleOutputs=function(){return [void 0]},_t.prototype.serialize=function(){return [this.name].concat(this.args.map(function(t){return t.serialize()}))},_t.parse=function(t,e){var r=t[0],n=_t.definitions[r];if(!n)return e.error('Unknown expression "'+r+'". If you wanted a literal array, use ["literal", [...]].',0);for(var i=Array.isArray(n)?n[0]:n.type,a=Array.isArray(n)?[[n[1],n[2]]]:n.overloads,o=a.filter(function(e){var r=e[0];return !Array.isArray(r)||r.length===t.length-1}),s=null,u=0,p=o;u<p.length;u+=1){var l=p[u],c=l[0],h=l[1];s=new St(e.registry,e.path,null,e.scope);for(var f=[],y=!1,d=1;d<t.length;d++){var m=t[d],v=Array.isArray(c)?c[d-1]:c.type,g=s.parse(m,1+f.length,v);if(!g){y=!0;break}f.push(g);}if(!y)if(Array.isArray(c)&&c.length!==f.length)s.error("Expected "+c.length+" arguments, but found "+f.length+" instead.");else{for(var x=0;x<f.length;x++){var b=Array.isArray(c)?c[x]:c.type,_=f[x];s.concat(x+1).checkSubtype(b,_.type);}if(0===s.errors.length)return new _t(r,i,h,f)}}if(1===o.length)e.errors.push.apply(e.errors,s.errors);else{for(var w=(o.length?o:a).map(function(t){var e,r=t[0];return e=r,Array.isArray(e)?"("+e.map(et).join(", ")+")":"("+et(e.type)+"...)"}).join(" | "),A=[],k=1;k<t.length;k++){var z=e.parse(t[k],1+A.length);if(!z)return null;A.push(et(z.type));}e.error("Expected arguments of type "+w+", but found ("+A.join(", ")+") instead.");}return null},_t.register=function(t,e){for(var r in _t.definitions=e,e)t[r]=_t;};var zt=function(t,e){this.type=e.type,this.name=t,this.boundExpression=e;};zt.parse=function(t,e){if(2!==t.length||"string"!=typeof t[1])return e.error("'var' expression requires exactly one string literal argument.");var r=t[1];return e.scope.has(r)?new zt(r,e.scope.get(r)):e.error('Unknown variable "'+r+'". Make sure "'+r+'" has been bound in an enclosing "let" expression before using it.',1)},zt.prototype.evaluate=function(t){return this.boundExpression.evaluate(t)},zt.prototype.eachChild=function(){},zt.prototype.possibleOutputs=function(){return [void 0]},zt.prototype.serialize=function(){return ["var",this.name]};var St=function(t,e,r,n,i){void 0===e&&(e=[]),void 0===n&&(n=new Z),void 0===i&&(i=[]),this.registry=t,this.path=e,this.key=e.map(function(t){return "["+t+"]"}).join(""),this.scope=n,this.errors=i,this.expectedType=r;};function Bt(t,e){for(var r,n,i=0,a=t.length-1,o=0;i<=a;){if(r=t[o=Math.floor((i+a)/2)],n=t[o+1],e===r||e>r&&e<n)return o;if(r<e)i=o+1;else{if(!(r>e))throw new yt("Input is not a number.");a=o-1;}}return Math.max(o-1,0)}St.prototype.parse=function(t,e,r,n,i){return void 0===i&&(i={}),e?this.concat(e,r,n)._parse(t,i):this._parse(t,i)},St.prototype._parse=function(t,e){if(null!==t&&"string"!=typeof t&&"boolean"!=typeof t&&"number"!=typeof t||(t=["literal",t]),Array.isArray(t)){if(0===t.length)return this.error('Expected an array with at least one element. If you wanted a literal array, use ["literal", []].');var r=t[0];if("string"!=typeof r)return this.error("Expression name must be a string, but found "+typeof r+' instead. If you wanted a literal array, use ["literal", [...]].',0),null;var n=this.registry[r];if(n){var i=n.parse(t,this);if(!i)return null;if(this.expectedType){var a=this.expectedType,o=i.type;if("string"!==a.kind&&"number"!==a.kind&&"boolean"!==a.kind&&"object"!==a.kind&&"array"!==a.kind||"value"!==o.kind)if("color"!==a.kind||"value"!==o.kind&&"string"!==o.kind)if("formatted"!==a.kind||"value"!==o.kind&&"string"!==o.kind){if(this.checkSubtype(this.expectedType,i.type))return null}else e.omitTypeAnnotations||(i=new gt(a,[i]));else e.omitTypeAnnotations||(i=new gt(a,[i]));else e.omitTypeAnnotations||(i=new mt(a,[i]));}if(!(i instanceof ft)&&function t(e){if(e instanceof zt)return t(e.boundExpression);if(e instanceof _t&&"error"===e.name)return !1;if(e instanceof st)return !1;var r=e instanceof gt||e instanceof mt;var n=!0;e.eachChild(function(e){n=r?n&&t(e):n&&e instanceof ft;});if(!n)return !1;return wt(e)&&kt(e,["zoom","heatmap-density","line-progress","is-supported-script"])}(i)){var s=new bt;try{i=new ft(i.type,i.evaluate(s));}catch(t){return this.error(t.message),null}}return i}return this.error('Unknown expression "'+r+'". If you wanted a literal array, use ["literal", [...]].',0)}return void 0===t?this.error("'undefined' value invalid. Use null instead."):"object"==typeof t?this.error('Bare objects invalid. Use ["literal", {...}] instead.'):this.error("Expected an array, but found "+typeof t+" instead.")},St.prototype.concat=function(t,e,r){var n="number"==typeof t?this.path.concat(t):this.path,i=r?this.scope.concat(r):this.scope;return new St(this.registry,n,e||null,i,this.errors)},St.prototype.error=function(t){for(var e=[],r=arguments.length-1;r-- >0;)e[r]=arguments[r+1];var n=""+this.key+e.map(function(t){return "["+t+"]"}).join("");this.errors.push(new N(n,t));},St.prototype.checkSubtype=function(t,e){var r=nt(t,e);return r&&this.error(r),r};var It=function(t,e,r){this.type=t,this.input=e,this.labels=[],this.outputs=[];for(var n=0,i=r;n<i.length;n+=1){var a=i[n],o=a[0],s=a[1];this.labels.push(o),this.outputs.push(s);}};function Vt(t,e,r){return t*(1-r)+e*r}It.parse=function(t,e){var r=t[1],n=t.slice(2);if(t.length-1<4)return e.error("Expected at least 4 arguments, but found only "+(t.length-1)+".");if((t.length-1)%2!=0)return e.error("Expected an even number of arguments.");if(!(r=e.parse(r,1,H)))return null;var i=[],a=null;e.expectedType&&"value"!==e.expectedType.kind&&(a=e.expectedType),n.unshift(-1/0);for(var o=0;o<n.length;o+=2){var s=n[o],u=n[o+1],p=o+1,l=o+2;if("number"!=typeof s)return e.error('Input/output pairs for "step" expressions must be defined using literal numeric values (not computed expressions) for the input values.',p);if(i.length&&i[i.length-1][0]>=s)return e.error('Input/output pairs for "step" expressions must be arranged with input values in strictly ascending order.',p);var c=e.parse(u,l,a);if(!c)return null;a=a||c.type,i.push([s,c]);}return new It(a,r,i)},It.prototype.evaluate=function(t){var e=this.labels,r=this.outputs;if(1===e.length)return r[0].evaluate(t);var n=this.input.evaluate(t);if(n<=e[0])return r[0].evaluate(t);var i=e.length;return n>=e[i-1]?r[i-1].evaluate(t):r[Bt(e,n)].evaluate(t)},It.prototype.eachChild=function(t){t(this.input);for(var e=0,r=this.outputs;e<r.length;e+=1){t(r[e]);}},It.prototype.possibleOutputs=function(){return (t=[]).concat.apply(t,this.outputs.map(function(t){return t.possibleOutputs()}));var t;},It.prototype.serialize=function(){for(var t=["step",this.input.serialize()],e=0;e<this.labels.length;e++)e>0&&t.push(this.labels[e]),t.push(this.outputs[e].serialize());return t};var Pt=Object.freeze({number:Vt,color:function(t,e,r){return new at(Vt(t.r,e.r,r),Vt(t.g,e.g,r),Vt(t.b,e.b,r),Vt(t.a,e.a,r))},array:function(t,e,r){return t.map(function(t,n){return Vt(t,e[n],r)})}}),Mt=.95047,Ct=1,Tt=1.08883,Et=4/29,Ft=6/29,Ot=3*Ft*Ft,Lt=Ft*Ft*Ft,Dt=Math.PI/180,jt=180/Math.PI;function Ut(t){return t>Lt?Math.pow(t,1/3):t/Ot+Et}function qt(t){return t>Ft?t*t*t:Ot*(t-Et)}function Rt(t){return 255*(t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055)}function Nt(t){return (t/=255)<=.04045?t/12.92:Math.pow((t+.055)/1.055,2.4)}function Zt(t){var e=Nt(t.r),r=Nt(t.g),n=Nt(t.b),i=Ut((.4124564*e+.3575761*r+.1804375*n)/Mt),a=Ut((.2126729*e+.7151522*r+.072175*n)/Ct);return {l:116*a-16,a:500*(i-a),b:200*(a-Ut((.0193339*e+.119192*r+.9503041*n)/Tt)),alpha:t.a}}function Xt(t){var e=(t.l+16)/116,r=isNaN(t.a)?e:e+t.a/500,n=isNaN(t.b)?e:e-t.b/200;return e=Ct*qt(e),r=Mt*qt(r),n=Tt*qt(n),new at(Rt(3.2404542*r-1.5371385*e-.4985314*n),Rt(-.969266*r+1.8760108*e+.041556*n),Rt(.0556434*r-.2040259*e+1.0572252*n),t.alpha)}var Ht={forward:Zt,reverse:Xt,interpolate:function(t,e,r){return {l:Vt(t.l,e.l,r),a:Vt(t.a,e.a,r),b:Vt(t.b,e.b,r),alpha:Vt(t.alpha,e.alpha,r)}}},Gt={forward:function(t){var e=Zt(t),r=e.l,n=e.a,i=e.b,a=Math.atan2(i,n)*jt;return {h:a<0?a+360:a,c:Math.sqrt(n*n+i*i),l:r,alpha:t.a}},reverse:function(t){var e=t.h*Dt,r=t.c;return Xt({l:t.l,a:Math.cos(e)*r,b:Math.sin(e)*r,alpha:t.alpha})},interpolate:function(t,e,r){return {h:function(t,e,r){var n=e-t;return t+r*(n>180||n<-180?n-360*Math.round(n/360):n)}(t.h,e.h,r),c:Vt(t.c,e.c,r),l:Vt(t.l,e.l,r),alpha:Vt(t.alpha,e.alpha,r)}}},Jt=Object.freeze({lab:Ht,hcl:Gt}),Kt=function(t,e,r,n,i){this.type=t,this.operator=e,this.interpolation=r,this.input=n,this.labels=[],this.outputs=[];for(var a=0,o=i;a<o.length;a+=1){var s=o[a],u=s[0],p=s[1];this.labels.push(u),this.outputs.push(p);}};function Yt(t,e,r,n){var i=n-r,a=t-r;return 0===i?0:1===e?a/i:(Math.pow(e,a)-1)/(Math.pow(e,i)-1)}Kt.interpolationFactor=function(t,e,n,i){var a=0;if("exponential"===t.name)a=Yt(e,t.base,n,i);else if("linear"===t.name)a=Yt(e,1,n,i);else if("cubic-bezier"===t.name){var o=t.controlPoints;a=new r(o[0],o[1],o[2],o[3]).solve(Yt(e,1,n,i));}return a},Kt.parse=function(t,e){var r=t[0],n=t[1],i=t[2],a=t.slice(3);if(!Array.isArray(n)||0===n.length)return e.error("Expected an interpolation type expression.",1);if("linear"===n[0])n={name:"linear"};else if("exponential"===n[0]){var o=n[1];if("number"!=typeof o)return e.error("Exponential interpolation requires a numeric base.",1,1);n={name:"exponential",base:o};}else{if("cubic-bezier"!==n[0])return e.error("Unknown interpolation type "+String(n[0]),1,0);var s=n.slice(1);if(4!==s.length||s.some(function(t){return "number"!=typeof t||t<0||t>1}))return e.error("Cubic bezier interpolation requires four numeric arguments with values between 0 and 1.",1);n={name:"cubic-bezier",controlPoints:s};}if(t.length-1<4)return e.error("Expected at least 4 arguments, but found only "+(t.length-1)+".");if((t.length-1)%2!=0)return e.error("Expected an even number of arguments.");if(!(i=e.parse(i,2,H)))return null;var u=[],p=null;"interpolate-hcl"===r||"interpolate-lab"===r?p=K:e.expectedType&&"value"!==e.expectedType.kind&&(p=e.expectedType);for(var l=0;l<a.length;l+=2){var c=a[l],h=a[l+1],f=l+3,y=l+4;if("number"!=typeof c)return e.error('Input/output pairs for "interpolate" expressions must be defined using literal numeric values (not computed expressions) for the input values.',f);if(u.length&&u[u.length-1][0]>=c)return e.error('Input/output pairs for "interpolate" expressions must be arranged with input values in strictly ascending order.',f);var d=e.parse(h,y,p);if(!d)return null;p=p||d.type,u.push([c,d]);}return "number"===p.kind||"color"===p.kind||"array"===p.kind&&"number"===p.itemType.kind&&"number"==typeof p.N?new Kt(p,r,n,i,u):e.error("Type "+et(p)+" is not interpolatable.")},Kt.prototype.evaluate=function(t){var e=this.labels,r=this.outputs;if(1===e.length)return r[0].evaluate(t);var n=this.input.evaluate(t);if(n<=e[0])return r[0].evaluate(t);var i=e.length;if(n>=e[i-1])return r[i-1].evaluate(t);var a=Bt(e,n),o=e[a],s=e[a+1],u=Kt.interpolationFactor(this.interpolation,n,o,s),p=r[a].evaluate(t),l=r[a+1].evaluate(t);return "interpolate"===this.operator?Pt[this.type.kind.toLowerCase()](p,l,u):"interpolate-hcl"===this.operator?Gt.reverse(Gt.interpolate(Gt.forward(p),Gt.forward(l),u)):Ht.reverse(Ht.interpolate(Ht.forward(p),Ht.forward(l),u))},Kt.prototype.eachChild=function(t){t(this.input);for(var e=0,r=this.outputs;e<r.length;e+=1){t(r[e]);}},Kt.prototype.possibleOutputs=function(){return (t=[]).concat.apply(t,this.outputs.map(function(t){return t.possibleOutputs()}));var t;},Kt.prototype.serialize=function(){var t;t="linear"===this.interpolation.name?["linear"]:"exponential"===this.interpolation.name?1===this.interpolation.base?["linear"]:["exponential",this.interpolation.base]:["cubic-bezier"].concat(this.interpolation.controlPoints);for(var e=[this.operator,t,this.input.serialize()],r=0;r<this.labels.length;r++)e.push(this.labels[r],this.outputs[r].serialize());return e};var $t=function(t,e){this.type=t,this.args=e;};$t.parse=function(t,e){if(t.length<2)return e.error("Expectected at least one argument.");var r=null,n=e.expectedType;n&&"value"!==n.kind&&(r=n);for(var i=[],a=0,o=t.slice(1);a<o.length;a+=1){var s=o[a],u=e.parse(s,1+i.length,r,void 0,{omitTypeAnnotations:!0});if(!u)return null;r=r||u.type,i.push(u);}var p=n&&i.some(function(t){return nt(n,t.type)});return new $t(p?$:r,i)},$t.prototype.evaluate=function(t){for(var e=null,r=0,n=this.args;r<n.length;r+=1){if(null!==(e=n[r].evaluate(t)))break}return e},$t.prototype.eachChild=function(t){this.args.forEach(t);},$t.prototype.possibleOutputs=function(){return (t=[]).concat.apply(t,this.args.map(function(t){return t.possibleOutputs()}));var t;},$t.prototype.serialize=function(){var t=["coalesce"];return this.eachChild(function(e){t.push(e.serialize());}),t};var Wt=function(t,e){this.type=e.type,this.bindings=[].concat(t),this.result=e;};Wt.prototype.evaluate=function(t){return this.result.evaluate(t)},Wt.prototype.eachChild=function(t){for(var e=0,r=this.bindings;e<r.length;e+=1){t(r[e][1]);}t(this.result);},Wt.parse=function(t,e){if(t.length<4)return e.error("Expected at least 3 arguments, but found "+(t.length-1)+" instead.");for(var r=[],n=1;n<t.length-1;n+=2){var i=t[n];if("string"!=typeof i)return e.error("Expected string, but found "+typeof i+" instead.",n);if(/[^a-zA-Z0-9_]/.test(i))return e.error("Variable names must contain only alphanumeric characters or '_'.",n);var a=e.parse(t[n+1],n+1);if(!a)return null;r.push([i,a]);}var o=e.parse(t[t.length-1],t.length-1,void 0,r);return o?new Wt(r,o):null},Wt.prototype.possibleOutputs=function(){return this.result.possibleOutputs()},Wt.prototype.serialize=function(){for(var t=["let"],e=0,r=this.bindings;e<r.length;e+=1){var n=r[e],i=n[0],a=n[1];t.push(i,a.serialize());}return t.push(this.result.serialize()),t};var Qt=function(t,e,r){this.type=t,this.index=e,this.input=r;};Qt.parse=function(t,e){if(3!==t.length)return e.error("Expected 2 arguments, but found "+(t.length-1)+" instead.");var r=e.parse(t[1],1,H),n=e.parse(t[2],2,tt(e.expectedType||$));if(!r||!n)return null;var i=n.type;return new Qt(i.itemType,r,n)},Qt.prototype.evaluate=function(t){var e=this.index.evaluate(t),r=this.input.evaluate(t);if(e<0)throw new yt("Array index out of bounds: "+e+" < 0.");if(e>=r.length)throw new yt("Array index out of bounds: "+e+" > "+(r.length-1)+".");if(e!==Math.floor(e))throw new yt("Array index must be an integer, but found "+e+" instead.");return r[e]},Qt.prototype.eachChild=function(t){t(this.index),t(this.input);},Qt.prototype.possibleOutputs=function(){return [void 0]},Qt.prototype.serialize=function(){return ["at",this.index.serialize(),this.input.serialize()]};var te=function(t,e,r,n,i,a){this.inputType=t,this.type=e,this.input=r,this.cases=n,this.outputs=i,this.otherwise=a;};te.parse=function(t,e){if(t.length<5)return e.error("Expected at least 4 arguments, but found only "+(t.length-1)+".");if(t.length%2!=1)return e.error("Expected an even number of arguments.");var r,n;e.expectedType&&"value"!==e.expectedType.kind&&(n=e.expectedType);for(var i={},a=[],o=2;o<t.length-1;o+=2){var s=t[o],u=t[o+1];Array.isArray(s)||(s=[s]);var p=e.concat(o);if(0===s.length)return p.error("Expected at least one branch label.");for(var l=0,c=s;l<c.length;l+=1){var h=c[l];if("number"!=typeof h&&"string"!=typeof h)return p.error("Branch labels must be numbers or strings.");if("number"==typeof h&&Math.abs(h)>Number.MAX_SAFE_INTEGER)return p.error("Branch labels must be integers no larger than "+Number.MAX_SAFE_INTEGER+".");if("number"==typeof h&&Math.floor(h)!==h)return p.error("Numeric branch labels must be integer values.");if(r){if(p.checkSubtype(r,pt(h)))return null}else r=pt(h);if(void 0!==i[String(h)])return p.error("Branch labels must be unique.");i[String(h)]=a.length;}var f=e.parse(u,o,n);if(!f)return null;n=n||f.type,a.push(f);}var y=e.parse(t[1],1,$);if(!y)return null;var d=e.parse(t[t.length-1],t.length-1,n);return d?"value"!==y.type.kind&&e.concat(1).checkSubtype(r,y.type)?null:new te(r,n,y,i,a,d):null},te.prototype.evaluate=function(t){var e=this.input.evaluate(t);return (pt(e)===this.inputType&&this.outputs[this.cases[e]]||this.otherwise).evaluate(t)},te.prototype.eachChild=function(t){t(this.input),this.outputs.forEach(t),t(this.otherwise);},te.prototype.possibleOutputs=function(){return (t=[]).concat.apply(t,this.outputs.map(function(t){return t.possibleOutputs()})).concat(this.otherwise.possibleOutputs());var t;},te.prototype.serialize=function(){for(var t=this,e=["match",this.input.serialize()],r=[],n={},i=0,a=Object.keys(this.cases).sort();i<a.length;i+=1){var o=a[i],s=n[t.cases[o]];void 0===s?(n[t.cases[o]]=r.length,r.push([t.cases[o],[o]])):r[s][1].push(o);}for(var u=function(e){return "number"===t.inputType.kind?Number(e):e},p=0,l=r;p<l.length;p+=1){var c=l[p],h=c[0],f=c[1];1===f.length?e.push(u(f[0])):e.push(f.map(u)),e.push(t.outputs[h].serialize());}return e.push(this.otherwise.serialize()),e};var ee=function(t,e,r){this.type=t,this.branches=e,this.otherwise=r;};function re(t,e){return "=="===t||"!="===t?"boolean"===e.kind||"string"===e.kind||"number"===e.kind||"null"===e.kind||"value"===e.kind:"string"===e.kind||"number"===e.kind||"value"===e.kind}function ne(t,e,r,n){return 0===n.compare(e,r)}function ie(t,e,r){var n="=="!==t&&"!="!==t;return function(){function i(t,e,r){this.type=J,this.lhs=t,this.rhs=e,this.collator=r,this.hasUntypedArgument="value"===t.type.kind||"value"===e.type.kind;}return i.parse=function(t,e){if(3!==t.length&&4!==t.length)return e.error("Expected two or three arguments.");var r=t[0],a=e.parse(t[1],1,$);if(!a)return null;if(!re(r,a.type))return e.concat(1).error('"'+r+"\" comparisons are not supported for type '"+et(a.type)+"'.");var o=e.parse(t[2],2,$);if(!o)return null;if(!re(r,o.type))return e.concat(2).error('"'+r+"\" comparisons are not supported for type '"+et(o.type)+"'.");if(a.type.kind!==o.type.kind&&"value"!==a.type.kind&&"value"!==o.type.kind)return e.error("Cannot compare types '"+et(a.type)+"' and '"+et(o.type)+"'.");n&&("value"===a.type.kind&&"value"!==o.type.kind?a=new mt(o.type,[a]):"value"!==a.type.kind&&"value"===o.type.kind&&(o=new mt(a.type,[o])));var s=null;if(4===t.length){if("string"!==a.type.kind&&"string"!==o.type.kind&&"value"!==a.type.kind&&"value"!==o.type.kind)return e.error("Cannot use collator to compare non-string types.");if(!(s=e.parse(t[3],3,W)))return null}return new i(a,o,s)},i.prototype.evaluate=function(i){var a=this.lhs.evaluate(i),o=this.rhs.evaluate(i);if(n&&this.hasUntypedArgument){var s=pt(a),u=pt(o);if(s.kind!==u.kind||"string"!==s.kind&&"number"!==s.kind)throw new yt('Expected arguments for "'+t+'" to be (string, string) or (number, number), but found ('+s.kind+", "+u.kind+") instead.")}if(this.collator&&!n&&this.hasUntypedArgument){var p=pt(a),l=pt(o);if("string"!==p.kind||"string"!==l.kind)return e(i,a,o)}return this.collator?r(i,a,o,this.collator.evaluate(i)):e(i,a,o)},i.prototype.eachChild=function(t){t(this.lhs),t(this.rhs),this.collator&&t(this.collator);},i.prototype.possibleOutputs=function(){return [!0,!1]},i.prototype.serialize=function(){var e=[t];return this.eachChild(function(t){e.push(t.serialize());}),e},i}()}ee.parse=function(t,e){if(t.length<4)return e.error("Expected at least 3 arguments, but found only "+(t.length-1)+".");if(t.length%2!=0)return e.error("Expected an odd number of arguments.");var r;e.expectedType&&"value"!==e.expectedType.kind&&(r=e.expectedType);for(var n=[],i=1;i<t.length-1;i+=2){var a=e.parse(t[i],i,J);if(!a)return null;var o=e.parse(t[i+1],i+1,r);if(!o)return null;n.push([a,o]),r=r||o.type;}var s=e.parse(t[t.length-1],t.length-1,r);return s?new ee(r,n,s):null},ee.prototype.evaluate=function(t){for(var e=0,r=this.branches;e<r.length;e+=1){var n=r[e],i=n[0],a=n[1];if(i.evaluate(t))return a.evaluate(t)}return this.otherwise.evaluate(t)},ee.prototype.eachChild=function(t){for(var e=0,r=this.branches;e<r.length;e+=1){var n=r[e],i=n[0],a=n[1];t(i),t(a);}t(this.otherwise);},ee.prototype.possibleOutputs=function(){return (t=[]).concat.apply(t,this.branches.map(function(t){t[0];return t[1].possibleOutputs()})).concat(this.otherwise.possibleOutputs());var t;},ee.prototype.serialize=function(){var t=["case"];return this.eachChild(function(e){t.push(e.serialize());}),t};var ae=ie("==",function(t,e,r){return e===r},ne),oe=ie("!=",function(t,e,r){return e!==r},function(t,e,r,n){return !ne(0,e,r,n)}),se=ie("<",function(t,e,r){return e<r},function(t,e,r,n){return n.compare(e,r)<0}),ue=ie(">",function(t,e,r){return e>r},function(t,e,r,n){return n.compare(e,r)>0}),pe=ie("<=",function(t,e,r){return e<=r},function(t,e,r,n){return n.compare(e,r)<=0}),le=ie(">=",function(t,e,r){return e>=r},function(t,e,r,n){return n.compare(e,r)>=0}),ce=function(t){this.type=H,this.input=t;};ce.parse=function(t,e){if(2!==t.length)return e.error("Expected 1 argument, but found "+(t.length-1)+" instead.");var r=e.parse(t[1],1);return r?"array"!==r.type.kind&&"string"!==r.type.kind&&"value"!==r.type.kind?e.error("Expected argument of type string or array, but found "+et(r.type)+" instead."):new ce(r):null},ce.prototype.evaluate=function(t){var e=this.input.evaluate(t);if("string"==typeof e)return e.length;if(Array.isArray(e))return e.length;throw new yt("Expected value to be of type string or array, but found "+et(pt(e))+" instead.")},ce.prototype.eachChild=function(t){t(this.input);},ce.prototype.possibleOutputs=function(){return [void 0]},ce.prototype.serialize=function(){var t=["length"];return this.eachChild(function(e){t.push(e.serialize());}),t};var he={"==":ae,"!=":oe,">":ue,"<":se,">=":le,"<=":pe,array:mt,at:Qt,boolean:mt,case:ee,coalesce:$t,collator:st,format:ht,interpolate:Kt,"interpolate-hcl":Kt,"interpolate-lab":Kt,length:ce,let:Wt,literal:ft,match:te,number:mt,object:mt,step:It,string:mt,"to-color":gt,"to-number":gt,var:zt};function fe(t,e){var r=e[0],n=e[1],i=e[2],a=e[3];r=r.evaluate(t),n=n.evaluate(t),i=i.evaluate(t);var o=a?a.evaluate(t):1,s=ut(r,n,i,o);if(s)throw new yt(s);return new at(r/255*o,n/255*o,i/255*o,o)}function ye(t,e){return t in e}function de(t,e){var r=e[t];return void 0===r?null:r}function me(t){return {type:t}}function ve(t){return {result:"success",value:t}}function ge(t){return {result:"error",value:t}}function xe(t){return "data-driven"===t["property-type"]||"cross-faded-data-driven"===t["property-type"]}function be(t){return !!t.expression&&t.expression.parameters.indexOf("zoom")>-1}function _e(t){return !!t.expression&&t.expression.interpolated}function we(t){return t instanceof Number?"number":t instanceof String?"string":t instanceof Boolean?"boolean":Array.isArray(t)?"array":null===t?"null":typeof t}function Ae(t){return "object"==typeof t&&null!==t&&!Array.isArray(t)}function ke(t){return t}function ze(t,e,r){return void 0!==t?t:void 0!==e?e:void 0!==r?r:void 0}function Se(t,e,r,n,i){return ze(typeof r===i?n[r]:void 0,t.default,e.default)}function Be(t,e,r){if("number"!==we(r))return ze(t.default,e.default);var n=t.stops.length;if(1===n)return t.stops[0][1];if(r<=t.stops[0][0])return t.stops[0][1];if(r>=t.stops[n-1][0])return t.stops[n-1][1];var i=Pe(t.stops,r);return t.stops[i][1]}function Ie(t,e,r){var n=void 0!==t.base?t.base:1;if("number"!==we(r))return ze(t.default,e.default);var i=t.stops.length;if(1===i)return t.stops[0][1];if(r<=t.stops[0][0])return t.stops[0][1];if(r>=t.stops[i-1][0])return t.stops[i-1][1];var a=Pe(t.stops,r),o=function(t,e,r,n){var i=n-r,a=t-r;return 0===i?0:1===e?a/i:(Math.pow(e,a)-1)/(Math.pow(e,i)-1)}(r,n,t.stops[a][0],t.stops[a+1][0]),s=t.stops[a][1],u=t.stops[a+1][1],p=Pt[e.type]||ke;if(t.colorSpace&&"rgb"!==t.colorSpace){var l=Jt[t.colorSpace];p=function(t,e){return l.reverse(l.interpolate(l.forward(t),l.forward(e),o))};}return "function"==typeof s.evaluate?{evaluate:function(){for(var t=[],e=arguments.length;e--;)t[e]=arguments[e];var r=s.evaluate.apply(void 0,t),n=u.evaluate.apply(void 0,t);if(void 0!==r&&void 0!==n)return p(r,n,o)}}:p(s,u,o)}function Ve(t,e,r){return "color"===e.type?r=at.parse(r):we(r)===e.type||"enum"===e.type&&e.values[r]||(r=void 0),ze(r,t.default,e.default)}function Pe(t,e){for(var r,n,i=0,a=t.length-1,o=0;i<=a;){if(r=t[o=Math.floor((i+a)/2)][0],n=t[o+1][0],e===r||e>r&&e<n)return o;r<e?i=o+1:r>e&&(a=o-1);}return Math.max(o-1,0)}_t.register(he,{error:[{kind:"error"},[G],function(t,e){var r=e[0];throw new yt(r.evaluate(t))}],typeof:[G,[$],function(t,e){return et(pt(e[0].evaluate(t)))}],"to-string":[G,[$],function(t,e){var r=e[0],n=typeof(r=r.evaluate(t));return null===r?"":"string"===n||"number"===n||"boolean"===n?String(r):r instanceof at||r instanceof ct?r.toString():JSON.stringify(r)}],"to-boolean":[J,[$],function(t,e){var r=e[0];return Boolean(r.evaluate(t))}],"to-rgba":[tt(H,4),[K],function(t,e){return e[0].evaluate(t).toArray()}],rgb:[K,[H,H,H],fe],rgba:[K,[H,H,H,H],fe],has:{type:J,overloads:[[[G],function(t,e){return ye(e[0].evaluate(t),t.properties())}],[[G,Y],function(t,e){var r=e[0],n=e[1];return ye(r.evaluate(t),n.evaluate(t))}]]},get:{type:$,overloads:[[[G],function(t,e){return de(e[0].evaluate(t),t.properties())}],[[G,Y],function(t,e){var r=e[0],n=e[1];return de(r.evaluate(t),n.evaluate(t))}]]},"feature-state":[$,[G],function(t,e){return de(e[0].evaluate(t),t.featureState||{})}],properties:[Y,[],function(t){return t.properties()}],"geometry-type":[G,[],function(t){return t.geometryType()}],id:[$,[],function(t){return t.id()}],zoom:[H,[],function(t){return t.globals.zoom}],"heatmap-density":[H,[],function(t){return t.globals.heatmapDensity||0}],"line-progress":[H,[],function(t){return t.globals.lineProgress||0}],"+":[H,me(H),function(t,e){for(var r=0,n=0,i=e;n<i.length;n+=1){r+=i[n].evaluate(t);}return r}],"*":[H,me(H),function(t,e){for(var r=1,n=0,i=e;n<i.length;n+=1){r*=i[n].evaluate(t);}return r}],"-":{type:H,overloads:[[[H,H],function(t,e){var r=e[0],n=e[1];return r.evaluate(t)-n.evaluate(t)}],[[H],function(t,e){return -e[0].evaluate(t)}]]},"/":[H,[H,H],function(t,e){var r=e[0],n=e[1];return r.evaluate(t)/n.evaluate(t)}],"%":[H,[H,H],function(t,e){var r=e[0],n=e[1];return r.evaluate(t)%n.evaluate(t)}],ln2:[H,[],function(){return Math.LN2}],pi:[H,[],function(){return Math.PI}],e:[H,[],function(){return Math.E}],"^":[H,[H,H],function(t,e){var r=e[0],n=e[1];return Math.pow(r.evaluate(t),n.evaluate(t))}],sqrt:[H,[H],function(t,e){var r=e[0];return Math.sqrt(r.evaluate(t))}],log10:[H,[H],function(t,e){var r=e[0];return Math.log10(r.evaluate(t))}],ln:[H,[H],function(t,e){var r=e[0];return Math.log(r.evaluate(t))}],log2:[H,[H],function(t,e){var r=e[0];return Math.log2(r.evaluate(t))}],sin:[H,[H],function(t,e){var r=e[0];return Math.sin(r.evaluate(t))}],cos:[H,[H],function(t,e){var r=e[0];return Math.cos(r.evaluate(t))}],tan:[H,[H],function(t,e){var r=e[0];return Math.tan(r.evaluate(t))}],asin:[H,[H],function(t,e){var r=e[0];return Math.asin(r.evaluate(t))}],acos:[H,[H],function(t,e){var r=e[0];return Math.acos(r.evaluate(t))}],atan:[H,[H],function(t,e){var r=e[0];return Math.atan(r.evaluate(t))}],min:[H,me(H),function(t,e){return Math.min.apply(Math,e.map(function(e){return e.evaluate(t)}))}],max:[H,me(H),function(t,e){return Math.max.apply(Math,e.map(function(e){return e.evaluate(t)}))}],abs:[H,[H],function(t,e){var r=e[0];return Math.abs(r.evaluate(t))}],round:[H,[H],function(t,e){var r=e[0].evaluate(t);return r<0?-Math.round(-r):Math.round(r)}],floor:[H,[H],function(t,e){var r=e[0];return Math.floor(r.evaluate(t))}],ceil:[H,[H],function(t,e){var r=e[0];return Math.ceil(r.evaluate(t))}],"filter-==":[J,[G,$],function(t,e){var r=e[0],n=e[1];return t.properties()[r.value]===n.value}],"filter-id-==":[J,[$],function(t,e){var r=e[0];return t.id()===r.value}],"filter-type-==":[J,[G],function(t,e){var r=e[0];return t.geometryType()===r.value}],"filter-<":[J,[G,$],function(t,e){var r=e[0],n=e[1],i=t.properties()[r.value],a=n.value;return typeof i==typeof a&&i<a}],"filter-id-<":[J,[$],function(t,e){var r=e[0],n=t.id(),i=r.value;return typeof n==typeof i&&n<i}],"filter->":[J,[G,$],function(t,e){var r=e[0],n=e[1],i=t.properties()[r.value],a=n.value;return typeof i==typeof a&&i>a}],"filter-id->":[J,[$],function(t,e){var r=e[0],n=t.id(),i=r.value;return typeof n==typeof i&&n>i}],"filter-<=":[J,[G,$],function(t,e){var r=e[0],n=e[1],i=t.properties()[r.value],a=n.value;return typeof i==typeof a&&i<=a}],"filter-id-<=":[J,[$],function(t,e){var r=e[0],n=t.id(),i=r.value;return typeof n==typeof i&&n<=i}],"filter->=":[J,[G,$],function(t,e){var r=e[0],n=e[1],i=t.properties()[r.value],a=n.value;return typeof i==typeof a&&i>=a}],"filter-id->=":[J,[$],function(t,e){var r=e[0],n=t.id(),i=r.value;return typeof n==typeof i&&n>=i}],"filter-has":[J,[$],function(t,e){return e[0].value in t.properties()}],"filter-has-id":[J,[],function(t){return null!==t.id()}],"filter-type-in":[J,[tt(G)],function(t,e){return e[0].value.indexOf(t.geometryType())>=0}],"filter-id-in":[J,[tt($)],function(t,e){return e[0].value.indexOf(t.id())>=0}],"filter-in-small":[J,[G,tt($)],function(t,e){var r=e[0];return e[1].value.indexOf(t.properties()[r.value])>=0}],"filter-in-large":[J,[G,tt($)],function(t,e){var r=e[0],n=e[1];return function(t,e,r,n){for(;r<=n;){var i=r+n>>1;if(e[i]===t)return !0;e[i]>t?n=i-1:r=i+1;}return !1}(t.properties()[r.value],n.value,0,n.value.length-1)}],all:{type:J,overloads:[[[J,J],function(t,e){var r=e[0],n=e[1];return r.evaluate(t)&&n.evaluate(t)}],[me(J),function(t,e){for(var r=0,n=e;r<n.length;r+=1){if(!n[r].evaluate(t))return !1}return !0}]]},any:{type:J,overloads:[[[J,J],function(t,e){var r=e[0],n=e[1];return r.evaluate(t)||n.evaluate(t)}],[me(J),function(t,e){for(var r=0,n=e;r<n.length;r+=1){if(n[r].evaluate(t))return !0}return !1}]]},"!":[J,[J],function(t,e){return !e[0].evaluate(t)}],"is-supported-script":[J,[G],function(t,e){var r=e[0],n=t.globals&&t.globals.isSupportedScript;return !n||n(r.evaluate(t))}],upcase:[G,[G],function(t,e){return e[0].evaluate(t).toUpperCase()}],downcase:[G,[G],function(t,e){return e[0].evaluate(t).toLowerCase()}],concat:[G,me(G),function(t,e){return e.map(function(e){return e.evaluate(t)}).join("")}],"resolved-locale":[G,[W],function(t,e){return e[0].evaluate(t).resolvedLocale()}]});var Me=function(t,e){var r;this.expression=t,this._warningHistory={},this._defaultValue="color"===(r=e).type&&Ae(r.default)?new at(0,0,0,0):"color"===r.type?at.parse(r.default)||null:void 0===r.default?null:r.default,"enum"===e.type&&(this._enumValues=e.values);};function Ce(t){return Array.isArray(t)&&t.length>0&&"string"==typeof t[0]&&t[0]in he}function Te(t,e){var r=new St(he,[],function(t){var e={color:K,string:G,number:H,enum:G,boolean:J};if("array"===t.type)return tt(e[t.value]||$,t.length);return e[t.type]||null}(e)),n=r.parse(t);return n?ve(new Me(n,e)):ge(r.errors)}Me.prototype.evaluateWithoutErrorHandling=function(t,e,r){return this._evaluator||(this._evaluator=new bt),this._evaluator.globals=t,this._evaluator.feature=e,this._evaluator.featureState=r,this.expression.evaluate(this._evaluator)},Me.prototype.evaluate=function(t,e,r){this._evaluator||(this._evaluator=new bt),this._evaluator.globals=t,this._evaluator.feature=e,this._evaluator.featureState=r;try{var n=this.expression.evaluate(this._evaluator);if(null==n)return this._defaultValue;if(this._enumValues&&!(n in this._enumValues))throw new yt("Expected value to be one of "+Object.keys(this._enumValues).map(function(t){return JSON.stringify(t)}).join(", ")+", but found "+JSON.stringify(n)+" instead.");return n}catch(t){return this._warningHistory[t.message]||(this._warningHistory[t.message]=!0,"undefined"!=typeof console&&console.warn(t.message)),this._defaultValue}};var Ee=function(t,e){this.kind=t,this._styleExpression=e,this.isStateDependent="constant"!==t&&!At(e.expression);};Ee.prototype.evaluateWithoutErrorHandling=function(t,e,r){return this._styleExpression.evaluateWithoutErrorHandling(t,e,r)},Ee.prototype.evaluate=function(t,e,r){return this._styleExpression.evaluate(t,e,r)};var Fe=function(t,e,r){this.kind=t,this.zoomStops=r.labels,this._styleExpression=e,this.isStateDependent="camera"!==t&&!At(e.expression),r instanceof Kt&&(this._interpolationType=r.interpolation);};function Oe(t,e){if("error"===(t=Te(t,e)).result)return t;var r=t.value.expression,n=wt(r);if(!n&&!xe(e))return ge([new N("","data expressions not supported")]);var i=kt(r,["zoom"]);if(!i&&!be(e))return ge([new N("","zoom expressions not supported")]);var a=function t(e){var r=null;if(e instanceof Wt)r=t(e.result);else if(e instanceof $t)for(var n=0,i=e.args;n<i.length;n+=1){var a=i[n];if(r=t(a))break}else(e instanceof It||e instanceof Kt)&&e.input instanceof _t&&"zoom"===e.input.name&&(r=e);if(r instanceof N)return r;e.eachChild(function(e){var n=t(e);n instanceof N?r=n:!r&&n?r=new N("",'"zoom" expression may only be used as input to a top-level "step" or "interpolate" expression.'):r&&n&&r!==n&&(r=new N("",'Only one zoom-based "step" or "interpolate" subexpression may be used in an expression.'));});return r}(r);return a||i?a instanceof N?ge([a]):a instanceof Kt&&!_e(e)?ge([new N("",'"interpolate" expressions cannot be used with this property')]):ve(a?new Fe(n?"camera":"composite",t.value,a):new Ee(n?"constant":"source",t.value)):ge([new N("",'"zoom" expression may only be used as input to a top-level "step" or "interpolate" expression.')])}Fe.prototype.evaluateWithoutErrorHandling=function(t,e,r){return this._styleExpression.evaluateWithoutErrorHandling(t,e,r)},Fe.prototype.evaluate=function(t,e,r){return this._styleExpression.evaluate(t,e,r)},Fe.prototype.interpolationFactor=function(t,e,r){return this._interpolationType?Kt.interpolationFactor(this._interpolationType,t,e,r):0};var Le=function(t,e){this._parameters=t,this._specification=e,U(this,function t(e,r){var n,i,a,o="color"===r.type,s=e.stops&&"object"==typeof e.stops[0][0],u=s||void 0!==e.property,p=s||!u,l=e.type||(_e(r)?"exponential":"interval");if(o&&((e=U({},e)).stops&&(e.stops=e.stops.map(function(t){return [t[0],at.parse(t[1])]})),e.default?e.default=at.parse(e.default):e.default=at.parse(r.default)),e.colorSpace&&"rgb"!==e.colorSpace&&!Jt[e.colorSpace])throw new Error("Unknown color space: "+e.colorSpace);if("exponential"===l)n=Ie;else if("interval"===l)n=Be;else if("categorical"===l){n=Se,i=Object.create(null);for(var c=0,h=e.stops;c<h.length;c+=1){var f=h[c];i[f[0]]=f[1];}a=typeof e.stops[0][0];}else{if("identity"!==l)throw new Error('Unknown function type "'+l+'"');n=Ve;}if(s){for(var y={},d=[],m=0;m<e.stops.length;m++){var v=e.stops[m],g=v[0].zoom;void 0===y[g]&&(y[g]={zoom:g,type:e.type,property:e.property,default:e.default,stops:[]},d.push(g)),y[g].stops.push([v[0].value,v[1]]);}for(var x=[],b=0,_=d;b<_.length;b+=1){var w=_[b];x.push([y[w].zoom,t(y[w],r)]);}return {kind:"composite",interpolationFactor:Kt.interpolationFactor.bind(void 0,{name:"linear"}),zoomStops:x.map(function(t){return t[0]}),evaluate:function(t,n){var i=t.zoom;return Ie({stops:x,base:e.base},r,i).evaluate(i,n)}}}return p?{kind:"camera",interpolationFactor:"exponential"===l?Kt.interpolationFactor.bind(void 0,{name:"exponential",base:void 0!==e.base?e.base:1}):function(){return 0},zoomStops:e.stops.map(function(t){return t[0]}),evaluate:function(t){var o=t.zoom;return n(e,r,o,i,a)}}:{kind:"source",evaluate:function(t,o){var s=o&&o.properties?o.properties[e.property]:void 0;return void 0===s?ze(e.default,r.default):n(e,r,s,i,a)}}}(this._parameters,this._specification));};function De(t,e){if(Ae(t))return new Le(t,e);if(Ce(t)){var r=Oe(t,e);if("error"===r.result)throw new Error(r.value.map(function(t){return t.key+": "+t.message}).join(", "));return r.value}var n=t;return "string"==typeof t&&"color"===e.type&&(n=at.parse(t)),{kind:"constant",evaluate:function(){return n}}}function je(t){var e=t.key,r=t.value,n=t.valueSpec||{},i=t.objectElementValidators||{},a=t.style,o=t.styleSpec,s=[],u=we(r);if("object"!==u)return [new D(e,r,"object expected, "+u+" found")];for(var p in r){var l=p.split(".")[0],c=n[l]||n["*"],h=void 0;if(i[l])h=i[l];else if(n[l])h=pr;else if(i["*"])h=i["*"];else{if(!n["*"]){s.push(new D(e,r[p],'unknown property "'+p+'"'));continue}h=pr;}s=s.concat(h({key:(e?e+".":e)+p,value:r[p],valueSpec:c,style:a,styleSpec:o,object:r,objectKey:p},r));}for(var f in n)i[f]||n[f].required&&void 0===n[f].default&&void 0===r[f]&&s.push(new D(e,r,'missing required property "'+f+'"'));return s}function Ue(t){var e=t.value,r=t.valueSpec,n=t.style,i=t.styleSpec,a=t.key,o=t.arrayElementValidator||pr;if("array"!==we(e))return [new D(a,e,"array expected, "+we(e)+" found")];if(r.length&&e.length!==r.length)return [new D(a,e,"array length "+r.length+" expected, length "+e.length+" found")];if(r["min-length"]&&e.length<r["min-length"])return [new D(a,e,"array length at least "+r["min-length"]+" expected, length "+e.length+" found")];var s={type:r.value};i.$version<7&&(s.function=r.function),"object"===we(r.value)&&(s=r.value);for(var u=[],p=0;p<e.length;p++)u=u.concat(o({array:e,arrayIndex:p,value:e[p],valueSpec:s,style:n,styleSpec:i,key:a+"["+p+"]"}));return u}function qe(t){var e=t.key,r=t.value,n=t.valueSpec,i=we(r);return "number"!==i?[new D(e,r,"number expected, "+i+" found")]:"minimum"in n&&r<n.minimum?[new D(e,r,r+" is less than the minimum value "+n.minimum)]:"maximum"in n&&r>n.maximum?[new D(e,r,r+" is greater than the maximum value "+n.maximum)]:[]}function Re(t){var e,r,n,i=t.valueSpec,a=q(t.value.type),o={},s="categorical"!==a&&void 0===t.value.property,u=!s,p="array"===we(t.value.stops)&&"array"===we(t.value.stops[0])&&"object"===we(t.value.stops[0][0]),l=je({key:t.key,value:t.value,valueSpec:t.styleSpec.function,style:t.style,styleSpec:t.styleSpec,objectElementValidators:{stops:function(t){if("identity"===a)return [new D(t.key,t.value,'identity function may not have a "stops" property')];var e=[],r=t.value;e=e.concat(Ue({key:t.key,value:r,valueSpec:t.valueSpec,style:t.style,styleSpec:t.styleSpec,arrayElementValidator:c})),"array"===we(r)&&0===r.length&&e.push(new D(t.key,r,"array must have at least one stop"));return e},default:function(t){return pr({key:t.key,value:t.value,valueSpec:i,style:t.style,styleSpec:t.styleSpec})}}});return "identity"===a&&s&&l.push(new D(t.key,t.value,'missing required property "property"')),"identity"===a||t.value.stops||l.push(new D(t.key,t.value,'missing required property "stops"')),"exponential"===a&&t.valueSpec.expression&&!_e(t.valueSpec)&&l.push(new D(t.key,t.value,"exponential functions not supported")),t.styleSpec.$version>=8&&(u&&!xe(t.valueSpec)?l.push(new D(t.key,t.value,"property functions not supported")):s&&!be(t.valueSpec)&&l.push(new D(t.key,t.value,"zoom functions not supported"))),"categorical"!==a&&!p||void 0!==t.value.property||l.push(new D(t.key,t.value,'"property" property is required')),l;function c(t){var e=[],a=t.value,s=t.key;if("array"!==we(a))return [new D(s,a,"array expected, "+we(a)+" found")];if(2!==a.length)return [new D(s,a,"array length 2 expected, length "+a.length+" found")];if(p){if("object"!==we(a[0]))return [new D(s,a,"object expected, "+we(a[0])+" found")];if(void 0===a[0].zoom)return [new D(s,a,"object stop key must have zoom")];if(void 0===a[0].value)return [new D(s,a,"object stop key must have value")];if(n&&n>q(a[0].zoom))return [new D(s,a[0].zoom,"stop zoom values must appear in ascending order")];q(a[0].zoom)!==n&&(n=q(a[0].zoom),r=void 0,o={}),e=e.concat(je({key:s+"[0]",value:a[0],valueSpec:{zoom:{}},style:t.style,styleSpec:t.styleSpec,objectElementValidators:{zoom:qe,value:h}}));}else e=e.concat(h({key:s+"[0]",value:a[0],valueSpec:{},style:t.style,styleSpec:t.styleSpec},a));return e.concat(pr({key:s+"[1]",value:a[1],valueSpec:i,style:t.style,styleSpec:t.styleSpec}))}function h(t,n){var s=we(t.value),u=q(t.value),p=null!==t.value?t.value:n;if(e){if(s!==e)return [new D(t.key,p,s+" stop domain type must match previous stop domain type "+e)]}else e=s;if("number"!==s&&"string"!==s&&"boolean"!==s)return [new D(t.key,p,"stop domain value must be a number, string, or boolean")];if("number"!==s&&"categorical"!==a){var l="number expected, "+s+" found";return xe(i)&&void 0===a&&(l+='\nIf you intended to use a categorical function, specify `"type": "categorical"`.'),[new D(t.key,p,l)]}return "categorical"!==a||"number"!==s||isFinite(u)&&Math.floor(u)===u?"categorical"!==a&&"number"===s&&void 0!==r&&u<r?[new D(t.key,p,"stop domain values must appear in ascending order")]:(r=u,"categorical"===a&&u in o?[new D(t.key,p,"stop domain values must be unique")]:(o[u]=!0,[])):[new D(t.key,p,"integer expected, found "+u)]}}function Ne(t){var e=("property"===t.expressionContext?Oe:Te)(R(t.value),t.valueSpec);return "error"===e.result?e.value.map(function(e){return new D(""+t.key+e.key,t.value,e.message)}):"property"===t.expressionContext&&"text-font"===t.propertyKey&&-1!==e.value._styleExpression.expression.possibleOutputs().indexOf(void 0)?[new D(t.key,t.value,'Invalid data expression for "'+t.propertyKey+'". Output values must be contained as literals within the expression.')]:"property"!==t.expressionContext||"layout"!==t.propertyType||At(e.value._styleExpression.expression)?[]:[new D(t.key,t.value,'"feature-state" data expressions are not supported with layout properties.')]}function Ze(t){var e=t.key,r=t.value,n=t.valueSpec,i=[];return Array.isArray(n.values)?-1===n.values.indexOf(q(r))&&i.push(new D(e,r,"expected one of ["+n.values.join(", ")+"], "+JSON.stringify(r)+" found")):-1===Object.keys(n.values).indexOf(q(r))&&i.push(new D(e,r,"expected one of ["+Object.keys(n.values).join(", ")+"], "+JSON.stringify(r)+" found")),i}function Xe(t){if(!0===t||!1===t)return !0;if(!Array.isArray(t)||0===t.length)return !1;switch(t[0]){case"has":return t.length>=2&&"$id"!==t[1]&&"$type"!==t[1];case"in":case"!in":case"!has":case"none":return !1;case"==":case"!=":case">":case">=":case"<":case"<=":return 3!==t.length||Array.isArray(t[1])||Array.isArray(t[2]);case"any":case"all":for(var e=0,r=t.slice(1);e<r.length;e+=1){var n=r[e];if(!Xe(n)&&"boolean"!=typeof n)return !1}return !0;default:return !0}}Le.deserialize=function(t){return new Le(t._parameters,t._specification)},Le.serialize=function(t){return {_parameters:t._parameters,_specification:t._specification}};var He={type:"boolean",default:!1,transition:!1,"property-type":"data-driven",expression:{interpolated:!1,parameters:["zoom","feature"]}};function Ge(t){if(null==t)return function(){return !0};Xe(t)||(t=Ke(t));var e=Te(t,He);if("error"===e.result)throw new Error(e.value.map(function(t){return t.key+": "+t.message}).join(", "));return function(t,r){return e.value.evaluate(t,r)}}function Je(t,e){return t<e?-1:t>e?1:0}function Ke(t){if(!t)return !0;var e,r=t[0];return t.length<=1?"any"!==r:"=="===r?Ye(t[1],t[2],"=="):"!="===r?Qe(Ye(t[1],t[2],"==")):"<"===r||">"===r||"<="===r||">="===r?Ye(t[1],t[2],r):"any"===r?(e=t.slice(1),["any"].concat(e.map(Ke))):"all"===r?["all"].concat(t.slice(1).map(Ke)):"none"===r?["all"].concat(t.slice(1).map(Ke).map(Qe)):"in"===r?$e(t[1],t.slice(2)):"!in"===r?Qe($e(t[1],t.slice(2))):"has"===r?We(t[1]):"!has"!==r||Qe(We(t[1]))}function Ye(t,e,r){switch(t){case"$type":return ["filter-type-"+r,e];case"$id":return ["filter-id-"+r,e];default:return ["filter-"+r,t,e]}}function $e(t,e){if(0===e.length)return !1;switch(t){case"$type":return ["filter-type-in",["literal",e]];case"$id":return ["filter-id-in",["literal",e]];default:return e.length>200&&!e.some(function(t){return typeof t!=typeof e[0]})?["filter-in-large",t,["literal",e.sort(Je)]]:["filter-in-small",t,["literal",e]]}}function We(t){switch(t){case"$type":return !0;case"$id":return ["filter-has-id"];default:return ["filter-has",t]}}function Qe(t){return ["!",t]}function tr(t){return Xe(R(t.value))?Ne(U({},t,{expressionContext:"filter",valueSpec:{value:"boolean"}})):function t(e){var r=e.value;var n=e.key;if("array"!==we(r))return [new D(n,r,"array expected, "+we(r)+" found")];var i=e.styleSpec;var a;var o=[];if(r.length<1)return [new D(n,r,"filter array must have at least 1 element")];o=o.concat(Ze({key:n+"[0]",value:r[0],valueSpec:i.filter_operator,style:e.style,styleSpec:e.styleSpec}));switch(q(r[0])){case"<":case"<=":case">":case">=":r.length>=2&&"$type"===q(r[1])&&o.push(new D(n,r,'"$type" cannot be use with operator "'+r[0]+'"'));case"==":case"!=":3!==r.length&&o.push(new D(n,r,'filter array for operator "'+r[0]+'" must have 3 elements'));case"in":case"!in":r.length>=2&&"string"!==(a=we(r[1]))&&o.push(new D(n+"[1]",r[1],"string expected, "+a+" found"));for(var s=2;s<r.length;s++)a=we(r[s]),"$type"===q(r[1])?o=o.concat(Ze({key:n+"["+s+"]",value:r[s],valueSpec:i.geometry_type,style:e.style,styleSpec:e.styleSpec})):"string"!==a&&"number"!==a&&"boolean"!==a&&o.push(new D(n+"["+s+"]",r[s],"string, number, or boolean expected, "+a+" found"));break;case"any":case"all":case"none":for(var u=1;u<r.length;u++)o=o.concat(t({key:n+"["+u+"]",value:r[u],style:e.style,styleSpec:e.styleSpec}));break;case"has":case"!has":a=we(r[1]),2!==r.length?o.push(new D(n,r,'filter array for "'+r[0]+'" operator must have 2 elements')):"string"!==a&&o.push(new D(n+"[1]",r[1],"string expected, "+a+" found"));}return o}(t)}function er(t,e){var r=t.key,n=t.style,i=t.styleSpec,a=t.value,o=t.objectKey,s=i[e+"_"+t.layerType];if(!s)return [];var u=o.match(/^(.*)-transition$/);if("paint"===e&&u&&s[u[1]]&&s[u[1]].transition)return pr({key:r,value:a,valueSpec:i.transition,style:n,styleSpec:i});var p,l=t.valueSpec||s[o];if(!l)return [new D(r,a,'unknown property "'+o+'"')];if("string"===we(a)&&xe(l)&&!l.tokens&&(p=/^{([^}]+)}$/.exec(a)))return [new D(r,a,'"'+o+'" does not support interpolation syntax\nUse an identity property function instead: `{ "type": "identity", "property": '+JSON.stringify(p[1])+" }`.")];var c=[];return "symbol"===t.layerType&&("text-field"===o&&n&&!n.glyphs&&c.push(new D(r,a,'use of "text-field" requires a style "glyphs" property')),"text-font"===o&&Ae(R(a))&&"identity"===q(a.type)&&c.push(new D(r,a,'"text-font" does not support identity functions'))),c.concat(pr({key:t.key,value:a,valueSpec:l,style:n,styleSpec:i,expressionContext:"property",propertyType:e,propertyKey:o}))}function rr(t){return er(t,"paint")}function nr(t){return er(t,"layout")}function ir(t){var e=[],r=t.value,n=t.key,i=t.style,a=t.styleSpec;r.type||r.ref||e.push(new D(n,r,'either "type" or "ref" is required'));var o,s=q(r.type),u=q(r.ref);if(r.id)for(var p=q(r.id),l=0;l<t.arrayIndex;l++){var c=i.layers[l];q(c.id)===p&&e.push(new D(n,r.id,'duplicate layer id "'+r.id+'", previously used at line '+c.id.__line__));}if("ref"in r)["type","source","source-layer","filter","layout"].forEach(function(t){t in r&&e.push(new D(n,r[t],'"'+t+'" is prohibited for ref layers'));}),i.layers.forEach(function(t){q(t.id)===u&&(o=t);}),o?o.ref?e.push(new D(n,r.ref,"ref cannot reference another ref layer")):s=q(o.type):e.push(new D(n,r.ref,'ref layer "'+u+'" not found'));else if("background"!==s)if(r.source){var h=i.sources&&i.sources[r.source],f=h&&q(h.type);h?"vector"===f&&"raster"===s?e.push(new D(n,r.source,'layer "'+r.id+'" requires a raster source')):"raster"===f&&"raster"!==s?e.push(new D(n,r.source,'layer "'+r.id+'" requires a vector source')):"vector"!==f||r["source-layer"]?"raster-dem"===f&&"hillshade"!==s?e.push(new D(n,r.source,"raster-dem source can only be used with layer type 'hillshade'.")):"line"!==s||!r.paint||!r.paint["line-gradient"]||"geojson"===f&&h.lineMetrics||e.push(new D(n,r,'layer "'+r.id+'" specifies a line-gradient, which requires a GeoJSON source with `lineMetrics` enabled.')):e.push(new D(n,r,'layer "'+r.id+'" must specify a "source-layer"')):e.push(new D(n,r.source,'source "'+r.source+'" not found'));}else e.push(new D(n,r,'missing required property "source"'));return e=e.concat(je({key:n,value:r,valueSpec:a.layer,style:t.style,styleSpec:t.styleSpec,objectElementValidators:{"*":function(){return []},type:function(){return pr({key:n+".type",value:r.type,valueSpec:a.layer.type,style:t.style,styleSpec:t.styleSpec,object:r,objectKey:"type"})},filter:tr,layout:function(t){return je({layer:r,key:t.key,value:t.value,style:t.style,styleSpec:t.styleSpec,objectElementValidators:{"*":function(t){return nr(U({layerType:s},t))}}})},paint:function(t){return je({layer:r,key:t.key,value:t.value,style:t.style,styleSpec:t.styleSpec,objectElementValidators:{"*":function(t){return rr(U({layerType:s},t))}}})}}}))}function ar(t){var e=t.value,r=t.key,n=t.styleSpec,i=t.style;if(!e.type)return [new D(r,e,'"type" is required')];var a=q(e.type),o=[];switch(a){case"vector":case"raster":case"raster-dem":if(o=o.concat(je({key:r,value:e,valueSpec:n["source_"+a.replace("-","_")],style:t.style,styleSpec:n})),"url"in e)for(var s in e)["type","url","tileSize"].indexOf(s)<0&&o.push(new D(r+"."+s,e[s],'a source with a "url" property may not include a "'+s+'" property'));return o;case"geojson":return je({key:r,value:e,valueSpec:n.source_geojson,style:i,styleSpec:n});case"video":return je({key:r,value:e,valueSpec:n.source_video,style:i,styleSpec:n});case"image":return je({key:r,value:e,valueSpec:n.source_image,style:i,styleSpec:n});case"canvas":return o.push(new D(r,null,"Please use runtime APIs to add canvas sources, rather than including them in stylesheets.","source.canvas")),o;default:return Ze({key:r+".type",value:e.type,valueSpec:{values:["vector","raster","raster-dem","geojson","video","image"]},style:i,styleSpec:n})}}function or(t){var e=t.value,r=t.styleSpec,n=r.light,i=t.style,a=[],o=we(e);if(void 0===e)return a;if("object"!==o)return a=a.concat([new D("light",e,"object expected, "+o+" found")]);for(var s in e){var u=s.match(/^(.*)-transition$/);a=u&&n[u[1]]&&n[u[1]].transition?a.concat(pr({key:s,value:e[s],valueSpec:r.transition,style:i,styleSpec:r})):n[s]?a.concat(pr({key:s,value:e[s],valueSpec:n[s],style:i,styleSpec:r})):a.concat([new D(s,e[s],'unknown property "'+s+'"')]);}return a}function sr(t){var e=t.value,r=t.key,n=we(e);return "string"!==n?[new D(r,e,"string expected, "+n+" found")]:[]}var ur={"*":function(){return []},array:Ue,boolean:function(t){var e=t.value,r=t.key,n=we(e);return "boolean"!==n?[new D(r,e,"boolean expected, "+n+" found")]:[]},number:qe,color:function(t){var e=t.key,r=t.value,n=we(r);return "string"!==n?[new D(e,r,"color expected, "+n+" found")]:null===it(r)?[new D(e,r,'color expected, "'+r+'" found')]:[]},constants:j,enum:Ze,filter:tr,function:Re,layer:ir,object:je,source:ar,light:or,string:sr,formatted:function(t){return 0===sr(t).length?[]:Ne(t)}};function pr(t){var e=t.value,r=t.valueSpec,n=t.styleSpec;return r.expression&&Ae(q(e))?Re(t):r.expression&&Ce(R(e))?Ne(t):r.type&&ur[r.type]?ur[r.type](t):je(U({},t,{valueSpec:r.type?n[r.type]:r}))}function lr(t){var e=t.value,r=t.key,n=sr(t);return n.length?n:(-1===e.indexOf("{fontstack}")&&n.push(new D(r,e,'"glyphs" url must include a "{fontstack}" token')),-1===e.indexOf("{range}")&&n.push(new D(r,e,'"glyphs" url must include a "{range}" token')),n)}function cr(t,e){e=e||L;var r=[];return r=r.concat(pr({key:"",value:t,valueSpec:e.$root,styleSpec:e,style:t,objectElementValidators:{glyphs:lr,"*":function(){return []}}})),t.constants&&(r=r.concat(j({key:"constants",value:t.constants,style:t,styleSpec:e}))),hr(r)}function hr(t){return [].concat(t).sort(function(t,e){return t.line-e.line})}function fr(t){return function(){return hr(t.apply(this,arguments))}}cr.source=fr(ar),cr.light=fr(or),cr.layer=fr(ir),cr.filter=fr(tr),cr.paintProperty=fr(rr),cr.layoutProperty=fr(nr);var yr=cr,dr=cr.light,mr=cr.paintProperty,vr=cr.layoutProperty;function gr(t,e){var r=!1;if(e&&e.length)for(var n=0,i=e;n<i.length;n+=1){var a=i[n];t.fire(new F(new Error(a.message))),r=!0;}return r}var xr=_r,br=3;function _r(t,e,r){var n=this.cells=[];if(t instanceof ArrayBuffer){this.arrayBuffer=t;var i=new Int32Array(this.arrayBuffer);t=i[0],e=i[1],r=i[2],this.d=e+2*r;for(var a=0;a<this.d*this.d;a++){var o=i[br+a],s=i[br+a+1];n.push(o===s?null:i.subarray(o,s));}var u=i[br+n.length],p=i[br+n.length+1];this.keys=i.subarray(u,p),this.bboxes=i.subarray(p),this.insert=this._insertReadonly;}else{this.d=e+2*r;for(var l=0;l<this.d*this.d;l++)n.push([]);this.keys=[],this.bboxes=[];}this.n=e,this.extent=t,this.padding=r,this.scale=e/t,this.uid=0;var c=r/e*t;this.min=-c,this.max=t+c;}_r.prototype.insert=function(t,e,r,n,i){this._forEachCell(e,r,n,i,this._insertCell,this.uid++),this.keys.push(t),this.bboxes.push(e),this.bboxes.push(r),this.bboxes.push(n),this.bboxes.push(i);},_r.prototype._insertReadonly=function(){throw"Cannot insert into a GridIndex created from an ArrayBuffer."},_r.prototype._insertCell=function(t,e,r,n,i,a){this.cells[i].push(a);},_r.prototype.query=function(t,e,r,n){var i=this.min,a=this.max;if(t<=i&&e<=i&&a<=r&&a<=n)return Array.prototype.slice.call(this.keys);var o=[];return this._forEachCell(t,e,r,n,this._queryCell,o,{}),o},_r.prototype._queryCell=function(t,e,r,n,i,a,o){var s=this.cells[i];if(null!==s)for(var u=this.keys,p=this.bboxes,l=0;l<s.length;l++){var c=s[l];if(void 0===o[c]){var h=4*c;t<=p[h+2]&&e<=p[h+3]&&r>=p[h+0]&&n>=p[h+1]?(o[c]=!0,a.push(u[c])):o[c]=!1;}}},_r.prototype._forEachCell=function(t,e,r,n,i,a,o){for(var s=this._convertToCellCoord(t),u=this._convertToCellCoord(e),p=this._convertToCellCoord(r),l=this._convertToCellCoord(n),c=s;c<=p;c++)for(var h=u;h<=l;h++){var f=this.d*h+c;if(i.call(this,t,e,r,n,f,a,o))return}},_r.prototype._convertToCellCoord=function(t){return Math.max(0,Math.min(this.d-1,Math.floor(t*this.scale)+this.padding))},_r.prototype.toArrayBuffer=function(){if(this.arrayBuffer)return this.arrayBuffer;for(var t=this.cells,e=br+this.cells.length+1+1,r=0,n=0;n<this.cells.length;n++)r+=this.cells[n].length;var i=new Int32Array(e+r+this.keys.length+this.bboxes.length);i[0]=this.extent,i[1]=this.n,i[2]=this.padding;for(var a=e,o=0;o<t.length;o++){var s=t[o];i[br+o]=a,i.set(s,a),a+=s.length;}return i[br+t.length]=a,i.set(this.keys,a),a+=this.keys.length,i[br+t.length+1]=a,i.set(this.bboxes,a),a+=this.bboxes.length,i.buffer};var wr=self.ImageData,Ar={};function kr(t,e,r){void 0===r&&(r={}),Object.defineProperty(e,"_classRegistryKey",{value:t,writeable:!1}),Ar[t]={klass:e,omit:r.omit||[],shallow:r.shallow||[]};}for(var zr in kr("Object",Object),xr.serialize=function(t,e){var r=t.toArrayBuffer();return e&&e.push(r),{buffer:r}},xr.deserialize=function(t){return new xr(t.buffer)},kr("Grid",xr),kr("Color",at),kr("Error",Error),kr("StylePropertyFunction",Le),kr("StyleExpression",Me,{omit:["_evaluator"]}),kr("ZoomDependentExpression",Fe),kr("ZoomConstantExpression",Ee),kr("CompoundExpression",_t,{omit:["_evaluate"]}),he)he[zr]._classRegistryKey||kr("Expression_"+zr,he[zr]);function Sr(t,e){if(null==t||"boolean"==typeof t||"number"==typeof t||"string"==typeof t||t instanceof Boolean||t instanceof Number||t instanceof String||t instanceof Date||t instanceof RegExp)return t;if(t instanceof ArrayBuffer)return e&&e.push(t),t;if(ArrayBuffer.isView(t)){var r=t;return e&&e.push(r.buffer),r}if(t instanceof wr)return e&&e.push(t.data.buffer),t;if(Array.isArray(t)){for(var n=[],i=0,a=t;i<a.length;i+=1){var o=a[i];n.push(Sr(o,e));}return n}if("object"==typeof t){var s=t.constructor,u=s._classRegistryKey;if(!u)throw new Error("can't serialize object of unregistered class");var p=s.serialize?s.serialize(t,e):{};if(!s.serialize){for(var l in t)if(t.hasOwnProperty(l)&&!(Ar[u].omit.indexOf(l)>=0)){var c=t[l];p[l]=Ar[u].shallow.indexOf(l)>=0?c:Sr(c,e);}t instanceof Error&&(p.message=t.message);}if(p.$name)throw new Error("$name property is reserved for worker serialization logic.");return "Object"!==u&&(p.$name=u),p}throw new Error("can't serialize object of type "+typeof t)}function Br(t){if(null==t||"boolean"==typeof t||"number"==typeof t||"string"==typeof t||t instanceof Boolean||t instanceof Number||t instanceof String||t instanceof Date||t instanceof RegExp||t instanceof ArrayBuffer||ArrayBuffer.isView(t)||t instanceof wr)return t;if(Array.isArray(t))return t.map(Br);if("object"==typeof t){var e=t.$name||"Object",r=Ar[e].klass;if(!r)throw new Error("can't deserialize unregistered class "+e);if(r.deserialize)return r.deserialize(t);for(var n=Object.create(r.prototype),i=0,a=Object.keys(t);i<a.length;i+=1){var o=a[i];if("$name"!==o){var s=t[o];n[o]=Ar[e].shallow.indexOf(o)>=0?s:Br(s);}}return n}throw new Error("can't deserialize object of type "+typeof t)}var Ir=function(){this.first=!0;};Ir.prototype.update=function(t,e){var r=Math.floor(t);return this.first?(this.first=!1,this.lastIntegerZoom=r,this.lastIntegerZoomTime=0,this.lastZoom=t,this.lastFloorZoom=r,!0):(this.lastFloorZoom>r?(this.lastIntegerZoom=r+1,this.lastIntegerZoomTime=e):this.lastFloorZoom<r&&(this.lastIntegerZoom=r,this.lastIntegerZoomTime=e),t!==this.lastZoom&&(this.lastZoom=t,this.lastFloorZoom=r,!0))};var Vr={"Latin-1 Supplement":function(t){return t>=128&&t<=255},Arabic:function(t){return t>=1536&&t<=1791},"Arabic Supplement":function(t){return t>=1872&&t<=1919},"Arabic Extended-A":function(t){return t>=2208&&t<=2303},"Hangul Jamo":function(t){return t>=4352&&t<=4607},"Unified Canadian Aboriginal Syllabics":function(t){return t>=5120&&t<=5759},Khmer:function(t){return t>=6016&&t<=6143},"Unified Canadian Aboriginal Syllabics Extended":function(t){return t>=6320&&t<=6399},"General Punctuation":function(t){return t>=8192&&t<=8303},"Letterlike Symbols":function(t){return t>=8448&&t<=8527},"Number Forms":function(t){return t>=8528&&t<=8591},"Miscellaneous Technical":function(t){return t>=8960&&t<=9215},"Control Pictures":function(t){return t>=9216&&t<=9279},"Optical Character Recognition":function(t){return t>=9280&&t<=9311},"Enclosed Alphanumerics":function(t){return t>=9312&&t<=9471},"Geometric Shapes":function(t){return t>=9632&&t<=9727},"Miscellaneous Symbols":function(t){return t>=9728&&t<=9983},"Miscellaneous Symbols and Arrows":function(t){return t>=11008&&t<=11263},"CJK Radicals Supplement":function(t){return t>=11904&&t<=12031},"Kangxi Radicals":function(t){return t>=12032&&t<=12255},"Ideographic Description Characters":function(t){return t>=12272&&t<=12287},"CJK Symbols and Punctuation":function(t){return t>=12288&&t<=12351},Hiragana:function(t){return t>=12352&&t<=12447},Katakana:function(t){return t>=12448&&t<=12543},Bopomofo:function(t){return t>=12544&&t<=12591},"Hangul Compatibility Jamo":function(t){return t>=12592&&t<=12687},Kanbun:function(t){return t>=12688&&t<=12703},"Bopomofo Extended":function(t){return t>=12704&&t<=12735},"CJK Strokes":function(t){return t>=12736&&t<=12783},"Katakana Phonetic Extensions":function(t){return t>=12784&&t<=12799},"Enclosed CJK Letters and Months":function(t){return t>=12800&&t<=13055},"CJK Compatibility":function(t){return t>=13056&&t<=13311},"CJK Unified Ideographs Extension A":function(t){return t>=13312&&t<=19903},"Yijing Hexagram Symbols":function(t){return t>=19904&&t<=19967},"CJK Unified Ideographs":function(t){return t>=19968&&t<=40959},"Yi Syllables":function(t){return t>=40960&&t<=42127},"Yi Radicals":function(t){return t>=42128&&t<=42191},"Hangul Jamo Extended-A":function(t){return t>=43360&&t<=43391},"Hangul Syllables":function(t){return t>=44032&&t<=55215},"Hangul Jamo Extended-B":function(t){return t>=55216&&t<=55295},"Private Use Area":function(t){return t>=57344&&t<=63743},"CJK Compatibility Ideographs":function(t){return t>=63744&&t<=64255},"Arabic Presentation Forms-A":function(t){return t>=64336&&t<=65023},"Vertical Forms":function(t){return t>=65040&&t<=65055},"CJK Compatibility Forms":function(t){return t>=65072&&t<=65103},"Small Form Variants":function(t){return t>=65104&&t<=65135},"Arabic Presentation Forms-B":function(t){return t>=65136&&t<=65279},"Halfwidth and Fullwidth Forms":function(t){return t>=65280&&t<=65519}};function Pr(t){for(var e=0,r=t;e<r.length;e+=1){if(Cr(r[e].charCodeAt(0)))return !0}return !1}function Mr(t){return !Vr.Arabic(t)&&(!Vr["Arabic Supplement"](t)&&(!Vr["Arabic Extended-A"](t)&&(!Vr["Arabic Presentation Forms-A"](t)&&!Vr["Arabic Presentation Forms-B"](t))))}function Cr(t){return 746===t||747===t||!(t<4352)&&(!!Vr["Bopomofo Extended"](t)||(!!Vr.Bopomofo(t)||(!(!Vr["CJK Compatibility Forms"](t)||t>=65097&&t<=65103)||(!!Vr["CJK Compatibility Ideographs"](t)||(!!Vr["CJK Compatibility"](t)||(!!Vr["CJK Radicals Supplement"](t)||(!!Vr["CJK Strokes"](t)||(!(!Vr["CJK Symbols and Punctuation"](t)||t>=12296&&t<=12305||t>=12308&&t<=12319||12336===t)||(!!Vr["CJK Unified Ideographs Extension A"](t)||(!!Vr["CJK Unified Ideographs"](t)||(!!Vr["Enclosed CJK Letters and Months"](t)||(!!Vr["Hangul Compatibility Jamo"](t)||(!!Vr["Hangul Jamo Extended-A"](t)||(!!Vr["Hangul Jamo Extended-B"](t)||(!!Vr["Hangul Jamo"](t)||(!!Vr["Hangul Syllables"](t)||(!!Vr.Hiragana(t)||(!!Vr["Ideographic Description Characters"](t)||(!!Vr.Kanbun(t)||(!!Vr["Kangxi Radicals"](t)||(!!Vr["Katakana Phonetic Extensions"](t)||(!(!Vr.Katakana(t)||12540===t)||(!(!Vr["Halfwidth and Fullwidth Forms"](t)||65288===t||65289===t||65293===t||t>=65306&&t<=65310||65339===t||65341===t||65343===t||t>=65371&&t<=65503||65507===t||t>=65512&&t<=65519)||(!(!Vr["Small Form Variants"](t)||t>=65112&&t<=65118||t>=65123&&t<=65126)||(!!Vr["Unified Canadian Aboriginal Syllabics"](t)||(!!Vr["Unified Canadian Aboriginal Syllabics Extended"](t)||(!!Vr["Vertical Forms"](t)||(!!Vr["Yijing Hexagram Symbols"](t)||(!!Vr["Yi Syllables"](t)||!!Vr["Yi Radicals"](t))))))))))))))))))))))))))))))}function Tr(t){return !(Cr(t)||function(t){return !!(Vr["Latin-1 Supplement"](t)&&(167===t||169===t||174===t||177===t||188===t||189===t||190===t||215===t||247===t)||Vr["General Punctuation"](t)&&(8214===t||8224===t||8225===t||8240===t||8241===t||8251===t||8252===t||8258===t||8263===t||8264===t||8265===t||8273===t)||Vr["Letterlike Symbols"](t)||Vr["Number Forms"](t)||Vr["Miscellaneous Technical"](t)&&(t>=8960&&t<=8967||t>=8972&&t<=8991||t>=8996&&t<=9e3||9003===t||t>=9085&&t<=9114||t>=9150&&t<=9165||9167===t||t>=9169&&t<=9179||t>=9186&&t<=9215)||Vr["Control Pictures"](t)&&9251!==t||Vr["Optical Character Recognition"](t)||Vr["Enclosed Alphanumerics"](t)||Vr["Geometric Shapes"](t)||Vr["Miscellaneous Symbols"](t)&&!(t>=9754&&t<=9759)||Vr["Miscellaneous Symbols and Arrows"](t)&&(t>=11026&&t<=11055||t>=11088&&t<=11097||t>=11192&&t<=11243)||Vr["CJK Symbols and Punctuation"](t)||Vr.Katakana(t)||Vr["Private Use Area"](t)||Vr["CJK Compatibility Forms"](t)||Vr["Small Form Variants"](t)||Vr["Halfwidth and Fullwidth Forms"](t)||8734===t||8756===t||8757===t||t>=9984&&t<=10087||t>=10102&&t<=10131||65532===t||65533===t)}(t))}function Er(t,e){return !(!e&&(t>=1424&&t<=2303||Vr["Arabic Presentation Forms-A"](t)||Vr["Arabic Presentation Forms-B"](t)))&&!(t>=2304&&t<=3583||t>=3840&&t<=4255||Vr.Khmer(t))}var Fr,Or=!1,Lr=null,Dr=!1,jr=new O,Ur={applyArabicShaping:null,processBidirectionalText:null,processStyledBidirectionalText:null,isLoaded:function(){return Dr||null!=Ur.applyArabicShaping}},qr=function(t,e){this.zoom=t,e?(this.now=e.now,this.fadeDuration=e.fadeDuration,this.zoomHistory=e.zoomHistory,this.transition=e.transition):(this.now=0,this.fadeDuration=0,this.zoomHistory=new Ir,this.transition={});};qr.prototype.isSupportedScript=function(t){return function(t,e){for(var r=0,n=t;r<n.length;r+=1)if(!Er(n[r].charCodeAt(0),e))return !1;return !0}(t,Ur.isLoaded())},qr.prototype.crossFadingFactor=function(){return 0===this.fadeDuration?1:Math.min((this.now-this.zoomHistory.lastIntegerZoomTime)/this.fadeDuration,1)},qr.prototype.getCrossfadeParameters=function(){var t=this.zoom,e=t-Math.floor(t),r=this.crossFadingFactor();return t>this.zoomHistory.lastIntegerZoom?{fromScale:2,toScale:1,t:e+(1-e)*r}:{fromScale:.5,toScale:1,t:1-(1-r)*e}};var Rr=function(t,e){this.property=t,this.value=e,this.expression=De(void 0===e?t.specification.default:e,t.specification);};Rr.prototype.isDataDriven=function(){return "source"===this.expression.kind||"composite"===this.expression.kind},Rr.prototype.possiblyEvaluate=function(t){return this.property.possiblyEvaluate(this,t)};var Nr=function(t){this.property=t,this.value=new Rr(t,void 0);};Nr.prototype.transitioned=function(t,e){return new Xr(this.property,this.value,e,c({},t.transition,this.transition),t.now)},Nr.prototype.untransitioned=function(){return new Xr(this.property,this.value,null,{},0)};var Zr=function(t){this._properties=t,this._values=Object.create(t.defaultTransitionablePropertyValues);};Zr.prototype.getValue=function(t){return g(this._values[t].value.value)},Zr.prototype.setValue=function(t,e){this._values.hasOwnProperty(t)||(this._values[t]=new Nr(this._values[t].property)),this._values[t].value=new Rr(this._values[t].property,null===e?void 0:g(e));},Zr.prototype.getTransition=function(t){return g(this._values[t].transition)},Zr.prototype.setTransition=function(t,e){this._values.hasOwnProperty(t)||(this._values[t]=new Nr(this._values[t].property)),this._values[t].transition=g(e)||void 0;},Zr.prototype.serialize=function(){for(var t={},e=0,r=Object.keys(this._values);e<r.length;e+=1){var n=r[e],i=this.getValue(n);void 0!==i&&(t[n]=i);var a=this.getTransition(n);void 0!==a&&(t[n+"-transition"]=a);}return t},Zr.prototype.transitioned=function(t,e){for(var r=new Hr(this._properties),n=0,i=Object.keys(this._values);n<i.length;n+=1){var a=i[n];r._values[a]=this._values[a].transitioned(t,e._values[a]);}return r},Zr.prototype.untransitioned=function(){for(var t=new Hr(this._properties),e=0,r=Object.keys(this._values);e<r.length;e+=1){var n=r[e];t._values[n]=this._values[n].untransitioned();}return t};var Xr=function(t,e,r,n,i){this.property=t,this.value=e,this.begin=i+n.delay||0,this.end=this.begin+n.duration||0,t.specification.transition&&(n.delay||n.duration)&&(this.prior=r);};Xr.prototype.possiblyEvaluate=function(t){var e=t.now||0,r=this.value.possiblyEvaluate(t),n=this.prior;if(n){if(e>this.end)return this.prior=null,r;if(this.value.isDataDriven())return this.prior=null,r;if(e<this.begin)return n.possiblyEvaluate(t);var i=(e-this.begin)/(this.end-this.begin);return this.property.interpolate(n.possiblyEvaluate(t),r,function(t){if(t<=0)return 0;if(t>=1)return 1;var e=t*t,r=e*t;return 4*(t<.5?r:3*(t-e)+r-.75)}(i))}return r};var Hr=function(t){this._properties=t,this._values=Object.create(t.defaultTransitioningPropertyValues);};Hr.prototype.possiblyEvaluate=function(t){for(var e=new Kr(this._properties),r=0,n=Object.keys(this._values);r<n.length;r+=1){var i=n[r];e._values[i]=this._values[i].possiblyEvaluate(t);}return e},Hr.prototype.hasTransition=function(){for(var t=0,e=Object.keys(this._values);t<e.length;t+=1){var r=e[t];if(this._values[r].prior)return !0}return !1};var Gr=function(t){this._properties=t,this._values=Object.create(t.defaultPropertyValues);};Gr.prototype.getValue=function(t){return g(this._values[t].value)},Gr.prototype.setValue=function(t,e){this._values[t]=new Rr(this._values[t].property,null===e?void 0:g(e));},Gr.prototype.serialize=function(){for(var t={},e=0,r=Object.keys(this._values);e<r.length;e+=1){var n=r[e],i=this.getValue(n);void 0!==i&&(t[n]=i);}return t},Gr.prototype.possiblyEvaluate=function(t){for(var e=new Kr(this._properties),r=0,n=Object.keys(this._values);r<n.length;r+=1){var i=n[r];e._values[i]=this._values[i].possiblyEvaluate(t);}return e};var Jr=function(t,e,r){this.property=t,this.value=e,this.parameters=r;};Jr.prototype.isConstant=function(){return "constant"===this.value.kind},Jr.prototype.constantOr=function(t){return "constant"===this.value.kind?this.value.value:t},Jr.prototype.evaluate=function(t,e){return this.property.evaluate(this.value,this.parameters,t,e)};var Kr=function(t){this._properties=t,this._values=Object.create(t.defaultPossiblyEvaluatedValues);};Kr.prototype.get=function(t){return this._values[t]};var Yr=function(t){this.specification=t;};Yr.prototype.possiblyEvaluate=function(t,e){return t.expression.evaluate(e)},Yr.prototype.interpolate=function(t,e,r){var n=Pt[this.specification.type];return n?n(t,e,r):t};var $r=function(t){this.specification=t;};$r.prototype.possiblyEvaluate=function(t,e){return "constant"===t.expression.kind||"camera"===t.expression.kind?new Jr(this,{kind:"constant",value:t.expression.evaluate(e)},e):new Jr(this,t.expression,e)},$r.prototype.interpolate=function(t,e,r){if("constant"!==t.value.kind||"constant"!==e.value.kind)return t;if(void 0===t.value.value||void 0===e.value.value)return new Jr(this,{kind:"constant",value:void 0},t.parameters);var n=Pt[this.specification.type];return n?new Jr(this,{kind:"constant",value:n(t.value.value,e.value.value,r)},t.parameters):t},$r.prototype.evaluate=function(t,e,r,n){return "constant"===t.kind?t.value:t.evaluate(e,r,n)};var Wr=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.possiblyEvaluate=function(t,e){if(void 0===t.value)return new Jr(this,{kind:"constant",value:void 0},e);if("constant"===t.expression.kind){var r=t.expression.evaluate(e),n=this._calculate(r,r,r,e);return new Jr(this,{kind:"constant",value:n},e)}if("camera"===t.expression.kind){var i=this._calculate(t.expression.evaluate({zoom:e.zoom-1}),t.expression.evaluate({zoom:e.zoom}),t.expression.evaluate({zoom:e.zoom+1}),e);return new Jr(this,{kind:"constant",value:i},e)}return new Jr(this,t.expression,e)},e.prototype.evaluate=function(t,e,r,n){if("source"===t.kind){var i=t.evaluate(e,r,n);return this._calculate(i,i,i,e)}return "composite"===t.kind?this._calculate(t.evaluate({zoom:Math.floor(e.zoom)-1},r,n),t.evaluate({zoom:Math.floor(e.zoom)},r,n),t.evaluate({zoom:Math.floor(e.zoom)+1},r,n),e):t.value},e.prototype._calculate=function(t,e,r,n){return n.zoom>n.zoomHistory.lastIntegerZoom?{from:t,to:e}:{from:r,to:e}},e.prototype.interpolate=function(t){return t},e}($r),Qr=function(t){this.specification=t;};Qr.prototype.possiblyEvaluate=function(t,e){if(void 0!==t.value){if("constant"===t.expression.kind){var r=t.expression.evaluate(e);return this._calculate(r,r,r,e)}return this._calculate(t.expression.evaluate(new qr(Math.floor(e.zoom-1),e)),t.expression.evaluate(new qr(Math.floor(e.zoom),e)),t.expression.evaluate(new qr(Math.floor(e.zoom+1),e)),e)}},Qr.prototype._calculate=function(t,e,r,n){return n.zoom>n.zoomHistory.lastIntegerZoom?{from:t,to:e}:{from:r,to:e}},Qr.prototype.interpolate=function(t){return t};var tn=function(t){this.specification=t;};tn.prototype.possiblyEvaluate=function(t,e){return !!t.expression.evaluate(e)},tn.prototype.interpolate=function(){return !1};var en=function(t){for(var e in this.properties=t,this.defaultPropertyValues={},this.defaultTransitionablePropertyValues={},this.defaultTransitioningPropertyValues={},this.defaultPossiblyEvaluatedValues={},t){var r=t[e],n=this.defaultPropertyValues[e]=new Rr(r,void 0),i=this.defaultTransitionablePropertyValues[e]=new Nr(r);this.defaultTransitioningPropertyValues[e]=i.untransitioned(),this.defaultPossiblyEvaluatedValues[e]=n.possiblyEvaluate({});}};kr("DataDrivenProperty",$r),kr("DataConstantProperty",Yr),kr("CrossFadedDataDrivenProperty",Wr),kr("CrossFadedProperty",Qr),kr("ColorRampProperty",tn);var rn=function(t){function e(e,r){for(var n in t.call(this),this.id=e.id,this.metadata=e.metadata,this.type=e.type,this.minzoom=e.minzoom,this.maxzoom=e.maxzoom,this.visibility="visible","background"!==e.type&&(this.source=e.source,this.sourceLayer=e["source-layer"],this.filter=e.filter),this._featureFilter=function(){return !0},r.layout&&(this._unevaluatedLayout=new Gr(r.layout)),this._transitionablePaint=new Zr(r.paint),e.paint)this.setPaintProperty(n,e.paint[n],{validate:!1});for(var i in e.layout)this.setLayoutProperty(i,e.layout[i],{validate:!1});this._transitioningPaint=this._transitionablePaint.untransitioned();}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.getCrossfadeParameters=function(){return this._crossfadeParameters},e.prototype.getLayoutProperty=function(t){return "visibility"===t?this.visibility:this._unevaluatedLayout.getValue(t)},e.prototype.setLayoutProperty=function(t,e,r){if(null!=e){var n="layers."+this.id+".layout."+t;if(this._validate(vr,n,t,e,r))return}"visibility"!==t?this._unevaluatedLayout.setValue(t,e):this.visibility="none"===e?e:"visible";},e.prototype.getPaintProperty=function(t){return d(t,"-transition")?this._transitionablePaint.getTransition(t.slice(0,-"-transition".length)):this._transitionablePaint.getValue(t)},e.prototype.setPaintProperty=function(t,e,r){if(null!=e){var n="layers."+this.id+".paint."+t;if(this._validate(mr,n,t,e,r))return !1}if(d(t,"-transition"))return this._transitionablePaint.setTransition(t.slice(0,-"-transition".length),e||void 0),!1;var i=this._transitionablePaint._values[t],a="cross-faded-data-driven"===i.property.specification["property-type"]&&!i.value.value&&e,o=this._transitionablePaint._values[t].value.isDataDriven();this._transitionablePaint.setValue(t,e);var s=this._transitionablePaint._values[t].value.isDataDriven();return this._handleSpecialPaintPropertyUpdate(t),s||o||a},e.prototype._handleSpecialPaintPropertyUpdate=function(t){},e.prototype.isHidden=function(t){return !!(this.minzoom&&t<this.minzoom)||(!!(this.maxzoom&&t>=this.maxzoom)||"none"===this.visibility)},e.prototype.updateTransitions=function(t){this._transitioningPaint=this._transitionablePaint.transitioned(t,this._transitioningPaint);},e.prototype.hasTransition=function(){return this._transitioningPaint.hasTransition()},e.prototype.recalculate=function(t){t.getCrossfadeParameters&&(this._crossfadeParameters=t.getCrossfadeParameters()),this._unevaluatedLayout&&(this.layout=this._unevaluatedLayout.possiblyEvaluate(t)),this.paint=this._transitioningPaint.possiblyEvaluate(t);},e.prototype.serialize=function(){var t={id:this.id,type:this.type,source:this.source,"source-layer":this.sourceLayer,metadata:this.metadata,minzoom:this.minzoom,maxzoom:this.maxzoom,filter:this.filter,layout:this._unevaluatedLayout&&this._unevaluatedLayout.serialize(),paint:this._transitionablePaint&&this._transitionablePaint.serialize()};return "none"===this.visibility&&(t.layout=t.layout||{},t.layout.visibility="none"),v(t,function(t,e){return !(void 0===t||"layout"===e&&!Object.keys(t).length||"paint"===e&&!Object.keys(t).length)})},e.prototype._validate=function(t,e,r,n,i){return (!i||!1!==i.validate)&&gr(this,t.call(yr,{key:e,layerType:this.type,objectKey:r,value:n,styleSpec:L,style:{glyphs:!0,sprite:!0}}))},e.prototype.hasOffscreenPass=function(){return !1},e.prototype.resize=function(){},e.prototype.isStateDependent=function(){for(var t in this.paint._values){var e=this.paint.get(t);if(e instanceof Jr&&xe(e.property.specification)&&(("source"===e.value.kind||"composite"===e.value.kind)&&e.value.isStateDependent))return !0}return !1},e}(O),nn={Int8:Int8Array,Uint8:Uint8Array,Int16:Int16Array,Uint16:Uint16Array,Int32:Int32Array,Uint32:Uint32Array,Float32:Float32Array},an=function(t,e){this._structArray=t,this._pos1=e*this.size,this._pos2=this._pos1/2,this._pos4=this._pos1/4,this._pos8=this._pos1/8;},on=function(){this.isTransferred=!1,this.capacity=-1,this.resize(0);};function sn(t,e){void 0===e&&(e=1);var r=0,n=0;return {members:t.map(function(t){var i,a=(i=t.type,nn[i].BYTES_PER_ELEMENT),o=r=un(r,Math.max(e,a)),s=t.components||1;return n=Math.max(n,a),r+=a*s,{name:t.name,type:t.type,components:s,offset:o}}),size:un(r,Math.max(n,e)),alignment:e}}function un(t,e){return Math.ceil(t/e)*e}on.serialize=function(t,e){return t._trim(),e&&(t.isTransferred=!0,e.push(t.arrayBuffer)),{length:t.length,arrayBuffer:t.arrayBuffer}},on.deserialize=function(t){var e=Object.create(this.prototype);return e.arrayBuffer=t.arrayBuffer,e.length=t.length,e.capacity=t.arrayBuffer.byteLength/e.bytesPerElement,e._refreshViews(),e},on.prototype._trim=function(){this.length!==this.capacity&&(this.capacity=this.length,this.arrayBuffer=this.arrayBuffer.slice(0,this.length*this.bytesPerElement),this._refreshViews());},on.prototype.clear=function(){this.length=0;},on.prototype.resize=function(t){this.reserve(t),this.length=t;},on.prototype.reserve=function(t){if(t>this.capacity){this.capacity=Math.max(t,Math.floor(5*this.capacity),128),this.arrayBuffer=new ArrayBuffer(this.capacity*this.bytesPerElement);var e=this.uint8;this._refreshViews(),e&&this.uint8.set(e);}},on.prototype._refreshViews=function(){throw new Error("_refreshViews() must be implemented by each concrete StructArray layout")};var pn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t,e){var r=this.length;this.resize(r+1);var n=2*r;return this.int16[n+0]=t,this.int16[n+1]=e,r},e.prototype.emplace=function(t,e,r){var n=2*t;return this.int16[n+0]=e,this.int16[n+1]=r,t},e}(on);pn.prototype.bytesPerElement=4,kr("StructArrayLayout2i4",pn);var ln=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t,e,r,n){var i=this.length;this.resize(i+1);var a=4*i;return this.int16[a+0]=t,this.int16[a+1]=e,this.int16[a+2]=r,this.int16[a+3]=n,i},e.prototype.emplace=function(t,e,r,n,i){var a=4*t;return this.int16[a+0]=e,this.int16[a+1]=r,this.int16[a+2]=n,this.int16[a+3]=i,t},e}(on);ln.prototype.bytesPerElement=8,kr("StructArrayLayout4i8",ln);var cn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t,e,r,n,i,a){var o=this.length;this.resize(o+1);var s=6*o;return this.int16[s+0]=t,this.int16[s+1]=e,this.int16[s+2]=r,this.int16[s+3]=n,this.int16[s+4]=i,this.int16[s+5]=a,o},e.prototype.emplace=function(t,e,r,n,i,a,o){var s=6*t;return this.int16[s+0]=e,this.int16[s+1]=r,this.int16[s+2]=n,this.int16[s+3]=i,this.int16[s+4]=a,this.int16[s+5]=o,t},e}(on);cn.prototype.bytesPerElement=12,kr("StructArrayLayout2i4i12",cn);var hn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t,e,r,n,i,a,o,s){var u=this.length;this.resize(u+1);var p=6*u,l=12*u;return this.int16[p+0]=t,this.int16[p+1]=e,this.int16[p+2]=r,this.int16[p+3]=n,this.uint8[l+8]=i,this.uint8[l+9]=a,this.uint8[l+10]=o,this.uint8[l+11]=s,u},e.prototype.emplace=function(t,e,r,n,i,a,o,s,u){var p=6*t,l=12*t;return this.int16[p+0]=e,this.int16[p+1]=r,this.int16[p+2]=n,this.int16[p+3]=i,this.uint8[l+8]=a,this.uint8[l+9]=o,this.uint8[l+10]=s,this.uint8[l+11]=u,t},e}(on);hn.prototype.bytesPerElement=12,kr("StructArrayLayout4i4ub12",hn);var fn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t,e,r,n,i,a,o,s){var u=this.length;this.resize(u+1);var p=8*u;return this.uint16[p+0]=t,this.uint16[p+1]=e,this.uint16[p+2]=r,this.uint16[p+3]=n,this.uint16[p+4]=i,this.uint16[p+5]=a,this.uint16[p+6]=o,this.uint16[p+7]=s,u},e.prototype.emplace=function(t,e,r,n,i,a,o,s,u){var p=8*t;return this.uint16[p+0]=e,this.uint16[p+1]=r,this.uint16[p+2]=n,this.uint16[p+3]=i,this.uint16[p+4]=a,this.uint16[p+5]=o,this.uint16[p+6]=s,this.uint16[p+7]=u,t},e}(on);fn.prototype.bytesPerElement=16,kr("StructArrayLayout8ui16",fn);var yn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t,e,r,n,i,a,o,s){var u=this.length;this.resize(u+1);var p=8*u;return this.int16[p+0]=t,this.int16[p+1]=e,this.int16[p+2]=r,this.int16[p+3]=n,this.uint16[p+4]=i,this.uint16[p+5]=a,this.uint16[p+6]=o,this.uint16[p+7]=s,u},e.prototype.emplace=function(t,e,r,n,i,a,o,s,u){var p=8*t;return this.int16[p+0]=e,this.int16[p+1]=r,this.int16[p+2]=n,this.int16[p+3]=i,this.uint16[p+4]=a,this.uint16[p+5]=o,this.uint16[p+6]=s,this.uint16[p+7]=u,t},e}(on);yn.prototype.bytesPerElement=16,kr("StructArrayLayout4i4ui16",yn);var dn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.float32=new Float32Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t,e,r){var n=this.length;this.resize(n+1);var i=3*n;return this.float32[i+0]=t,this.float32[i+1]=e,this.float32[i+2]=r,n},e.prototype.emplace=function(t,e,r,n){var i=3*t;return this.float32[i+0]=e,this.float32[i+1]=r,this.float32[i+2]=n,t},e}(on);dn.prototype.bytesPerElement=12,kr("StructArrayLayout3f12",dn);var mn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.uint32=new Uint32Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t){var e=this.length;this.resize(e+1);var r=1*e;return this.uint32[r+0]=t,e},e.prototype.emplace=function(t,e){var r=1*t;return this.uint32[r+0]=e,t},e}(on);mn.prototype.bytesPerElement=4,kr("StructArrayLayout1ul4",mn);var vn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer),this.uint32=new Uint32Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t,e,r,n,i,a,o,s,u,p,l){var c=this.length;this.resize(c+1);var h=12*c,f=6*c;return this.int16[h+0]=t,this.int16[h+1]=e,this.int16[h+2]=r,this.int16[h+3]=n,this.int16[h+4]=i,this.int16[h+5]=a,this.uint32[f+3]=o,this.uint16[h+8]=s,this.uint16[h+9]=u,this.int16[h+10]=p,this.int16[h+11]=l,c},e.prototype.emplace=function(t,e,r,n,i,a,o,s,u,p,l,c){var h=12*t,f=6*t;return this.int16[h+0]=e,this.int16[h+1]=r,this.int16[h+2]=n,this.int16[h+3]=i,this.int16[h+4]=a,this.int16[h+5]=o,this.uint32[f+3]=s,this.uint16[h+8]=u,this.uint16[h+9]=p,this.int16[h+10]=l,this.int16[h+11]=c,t},e}(on);vn.prototype.bytesPerElement=24,kr("StructArrayLayout6i1ul2ui2i24",vn);var gn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t,e,r,n,i,a){var o=this.length;this.resize(o+1);var s=6*o;return this.int16[s+0]=t,this.int16[s+1]=e,this.int16[s+2]=r,this.int16[s+3]=n,this.int16[s+4]=i,this.int16[s+5]=a,o},e.prototype.emplace=function(t,e,r,n,i,a,o){var s=6*t;return this.int16[s+0]=e,this.int16[s+1]=r,this.int16[s+2]=n,this.int16[s+3]=i,this.int16[s+4]=a,this.int16[s+5]=o,t},e}(on);gn.prototype.bytesPerElement=12,kr("StructArrayLayout2i2i2i12",gn);var xn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t,e){var r=this.length;this.resize(r+1);var n=4*r;return this.uint8[n+0]=t,this.uint8[n+1]=e,r},e.prototype.emplace=function(t,e,r){var n=4*t;return this.uint8[n+0]=e,this.uint8[n+1]=r,t},e}(on);xn.prototype.bytesPerElement=4,kr("StructArrayLayout2ub4",xn);var bn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer),this.uint32=new Uint32Array(this.arrayBuffer),this.float32=new Float32Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t,e,r,n,i,a,o,s,u,p,l,c,h,f){var y=this.length;this.resize(y+1);var d=20*y,m=10*y,v=40*y;return this.int16[d+0]=t,this.int16[d+1]=e,this.uint16[d+2]=r,this.uint16[d+3]=n,this.uint32[m+2]=i,this.uint32[m+3]=a,this.uint32[m+4]=o,this.uint16[d+10]=s,this.uint16[d+11]=u,this.uint16[d+12]=p,this.float32[m+7]=l,this.float32[m+8]=c,this.uint8[v+36]=h,this.uint8[v+37]=f,y},e.prototype.emplace=function(t,e,r,n,i,a,o,s,u,p,l,c,h,f,y){var d=20*t,m=10*t,v=40*t;return this.int16[d+0]=e,this.int16[d+1]=r,this.uint16[d+2]=n,this.uint16[d+3]=i,this.uint32[m+2]=a,this.uint32[m+3]=o,this.uint32[m+4]=s,this.uint16[d+10]=u,this.uint16[d+11]=p,this.uint16[d+12]=l,this.float32[m+7]=c,this.float32[m+8]=h,this.uint8[v+36]=f,this.uint8[v+37]=y,t},e}(on);bn.prototype.bytesPerElement=40,kr("StructArrayLayout2i2ui3ul3ui2f2ub40",bn);var _n=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer),this.uint32=new Uint32Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t,e,r,n,i,a,o,s,u,p,l,c,h,f){var y=this.length;this.resize(y+1);var d=16*y,m=8*y;return this.int16[d+0]=t,this.int16[d+1]=e,this.int16[d+2]=r,this.int16[d+3]=n,this.uint16[d+4]=i,this.uint16[d+5]=a,this.uint16[d+6]=o,this.uint16[d+7]=s,this.uint16[d+8]=u,this.uint16[d+9]=p,this.uint16[d+10]=l,this.uint16[d+11]=c,this.uint16[d+12]=h,this.uint32[m+7]=f,y},e.prototype.emplace=function(t,e,r,n,i,a,o,s,u,p,l,c,h,f,y){var d=16*t,m=8*t;return this.int16[d+0]=e,this.int16[d+1]=r,this.int16[d+2]=n,this.int16[d+3]=i,this.uint16[d+4]=a,this.uint16[d+5]=o,this.uint16[d+6]=s,this.uint16[d+7]=u,this.uint16[d+8]=p,this.uint16[d+9]=l,this.uint16[d+10]=c,this.uint16[d+11]=h,this.uint16[d+12]=f,this.uint32[m+7]=y,t},e}(on);_n.prototype.bytesPerElement=32,kr("StructArrayLayout4i9ui1ul32",_n);var wn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.float32=new Float32Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t){var e=this.length;this.resize(e+1);var r=1*e;return this.float32[r+0]=t,e},e.prototype.emplace=function(t,e){var r=1*t;return this.float32[r+0]=e,t},e}(on);wn.prototype.bytesPerElement=4,kr("StructArrayLayout1f4",wn);var An=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t,e,r){var n=this.length;this.resize(n+1);var i=3*n;return this.int16[i+0]=t,this.int16[i+1]=e,this.int16[i+2]=r,n},e.prototype.emplace=function(t,e,r,n){var i=3*t;return this.int16[i+0]=e,this.int16[i+1]=r,this.int16[i+2]=n,t},e}(on);An.prototype.bytesPerElement=6,kr("StructArrayLayout3i6",An);var kn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.uint32=new Uint32Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t,e,r){var n=this.length;this.resize(n+1);var i=2*n,a=4*n;return this.uint32[i+0]=t,this.uint16[a+2]=e,this.uint16[a+3]=r,n},e.prototype.emplace=function(t,e,r,n){var i=2*t,a=4*t;return this.uint32[i+0]=e,this.uint16[a+2]=r,this.uint16[a+3]=n,t},e}(on);kn.prototype.bytesPerElement=8,kr("StructArrayLayout1ul2ui8",kn);var zn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t,e,r){var n=this.length;this.resize(n+1);var i=3*n;return this.uint16[i+0]=t,this.uint16[i+1]=e,this.uint16[i+2]=r,n},e.prototype.emplace=function(t,e,r,n){var i=3*t;return this.uint16[i+0]=e,this.uint16[i+1]=r,this.uint16[i+2]=n,t},e}(on);zn.prototype.bytesPerElement=6,kr("StructArrayLayout3ui6",zn);var Sn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t,e){var r=this.length;this.resize(r+1);var n=2*r;return this.uint16[n+0]=t,this.uint16[n+1]=e,r},e.prototype.emplace=function(t,e,r){var n=2*t;return this.uint16[n+0]=e,this.uint16[n+1]=r,t},e}(on);Sn.prototype.bytesPerElement=4,kr("StructArrayLayout2ui4",Sn);var Bn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t){var e=this.length;this.resize(e+1);var r=1*e;return this.uint16[r+0]=t,e},e.prototype.emplace=function(t,e){var r=1*t;return this.uint16[r+0]=e,t},e}(on);Bn.prototype.bytesPerElement=2,kr("StructArrayLayout1ui2",Bn);var In=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.float32=new Float32Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t,e){var r=this.length;this.resize(r+1);var n=2*r;return this.float32[n+0]=t,this.float32[n+1]=e,r},e.prototype.emplace=function(t,e,r){var n=2*t;return this.float32[n+0]=e,this.float32[n+1]=r,t},e}(on);In.prototype.bytesPerElement=8,kr("StructArrayLayout2f8",In);var Vn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._refreshViews=function(){this.uint8=new Uint8Array(this.arrayBuffer),this.float32=new Float32Array(this.arrayBuffer);},e.prototype.emplaceBack=function(t,e,r,n){var i=this.length;this.resize(i+1);var a=4*i;return this.float32[a+0]=t,this.float32[a+1]=e,this.float32[a+2]=r,this.float32[a+3]=n,i},e.prototype.emplace=function(t,e,r,n,i){var a=4*t;return this.float32[a+0]=e,this.float32[a+1]=r,this.float32[a+2]=n,this.float32[a+3]=i,t},e}(on);Vn.prototype.bytesPerElement=16,kr("StructArrayLayout4f16",Vn);var Pn=function(t){function e(){t.apply(this,arguments);}t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e;var r={anchorPointX:{configurable:!0},anchorPointY:{configurable:!0},x1:{configurable:!0},y1:{configurable:!0},x2:{configurable:!0},y2:{configurable:!0},featureIndex:{configurable:!0},sourceLayerIndex:{configurable:!0},bucketIndex:{configurable:!0},radius:{configurable:!0},signedDistanceFromAnchor:{configurable:!0},anchorPoint:{configurable:!0}};return r.anchorPointX.get=function(){return this._structArray.int16[this._pos2+0]},r.anchorPointX.set=function(t){this._structArray.int16[this._pos2+0]=t;},r.anchorPointY.get=function(){return this._structArray.int16[this._pos2+1]},r.anchorPointY.set=function(t){this._structArray.int16[this._pos2+1]=t;},r.x1.get=function(){return this._structArray.int16[this._pos2+2]},r.x1.set=function(t){this._structArray.int16[this._pos2+2]=t;},r.y1.get=function(){return this._structArray.int16[this._pos2+3]},r.y1.set=function(t){this._structArray.int16[this._pos2+3]=t;},r.x2.get=function(){return this._structArray.int16[this._pos2+4]},r.x2.set=function(t){this._structArray.int16[this._pos2+4]=t;},r.y2.get=function(){return this._structArray.int16[this._pos2+5]},r.y2.set=function(t){this._structArray.int16[this._pos2+5]=t;},r.featureIndex.get=function(){return this._structArray.uint32[this._pos4+3]},r.featureIndex.set=function(t){this._structArray.uint32[this._pos4+3]=t;},r.sourceLayerIndex.get=function(){return this._structArray.uint16[this._pos2+8]},r.sourceLayerIndex.set=function(t){this._structArray.uint16[this._pos2+8]=t;},r.bucketIndex.get=function(){return this._structArray.uint16[this._pos2+9]},r.bucketIndex.set=function(t){this._structArray.uint16[this._pos2+9]=t;},r.radius.get=function(){return this._structArray.int16[this._pos2+10]},r.radius.set=function(t){this._structArray.int16[this._pos2+10]=t;},r.signedDistanceFromAnchor.get=function(){return this._structArray.int16[this._pos2+11]},r.signedDistanceFromAnchor.set=function(t){this._structArray.int16[this._pos2+11]=t;},r.anchorPoint.get=function(){return new a(this.anchorPointX,this.anchorPointY)},Object.defineProperties(e.prototype,r),e}(an);Pn.prototype.size=24;var Mn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.get=function(t){return new Pn(this,t)},e}(vn);kr("CollisionBoxArray",Mn);var Cn=function(t){function e(){t.apply(this,arguments);}t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e;var r={anchorX:{configurable:!0},anchorY:{configurable:!0},glyphStartIndex:{configurable:!0},numGlyphs:{configurable:!0},vertexStartIndex:{configurable:!0},lineStartIndex:{configurable:!0},lineLength:{configurable:!0},segment:{configurable:!0},lowerSize:{configurable:!0},upperSize:{configurable:!0},lineOffsetX:{configurable:!0},lineOffsetY:{configurable:!0},writingMode:{configurable:!0},hidden:{configurable:!0}};return r.anchorX.get=function(){return this._structArray.int16[this._pos2+0]},r.anchorX.set=function(t){this._structArray.int16[this._pos2+0]=t;},r.anchorY.get=function(){return this._structArray.int16[this._pos2+1]},r.anchorY.set=function(t){this._structArray.int16[this._pos2+1]=t;},r.glyphStartIndex.get=function(){return this._structArray.uint16[this._pos2+2]},r.glyphStartIndex.set=function(t){this._structArray.uint16[this._pos2+2]=t;},r.numGlyphs.get=function(){return this._structArray.uint16[this._pos2+3]},r.numGlyphs.set=function(t){this._structArray.uint16[this._pos2+3]=t;},r.vertexStartIndex.get=function(){return this._structArray.uint32[this._pos4+2]},r.vertexStartIndex.set=function(t){this._structArray.uint32[this._pos4+2]=t;},r.lineStartIndex.get=function(){return this._structArray.uint32[this._pos4+3]},r.lineStartIndex.set=function(t){this._structArray.uint32[this._pos4+3]=t;},r.lineLength.get=function(){return this._structArray.uint32[this._pos4+4]},r.lineLength.set=function(t){this._structArray.uint32[this._pos4+4]=t;},r.segment.get=function(){return this._structArray.uint16[this._pos2+10]},r.segment.set=function(t){this._structArray.uint16[this._pos2+10]=t;},r.lowerSize.get=function(){return this._structArray.uint16[this._pos2+11]},r.lowerSize.set=function(t){this._structArray.uint16[this._pos2+11]=t;},r.upperSize.get=function(){return this._structArray.uint16[this._pos2+12]},r.upperSize.set=function(t){this._structArray.uint16[this._pos2+12]=t;},r.lineOffsetX.get=function(){return this._structArray.float32[this._pos4+7]},r.lineOffsetX.set=function(t){this._structArray.float32[this._pos4+7]=t;},r.lineOffsetY.get=function(){return this._structArray.float32[this._pos4+8]},r.lineOffsetY.set=function(t){this._structArray.float32[this._pos4+8]=t;},r.writingMode.get=function(){return this._structArray.uint8[this._pos1+36]},r.writingMode.set=function(t){this._structArray.uint8[this._pos1+36]=t;},r.hidden.get=function(){return this._structArray.uint8[this._pos1+37]},r.hidden.set=function(t){this._structArray.uint8[this._pos1+37]=t;},Object.defineProperties(e.prototype,r),e}(an);Cn.prototype.size=40;var Tn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.get=function(t){return new Cn(this,t)},e}(bn);kr("PlacedSymbolArray",Tn);var En=function(t){function e(){t.apply(this,arguments);}t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e;var r={anchorX:{configurable:!0},anchorY:{configurable:!0},horizontalPlacedTextSymbolIndex:{configurable:!0},verticalPlacedTextSymbolIndex:{configurable:!0},key:{configurable:!0},textBoxStartIndex:{configurable:!0},textBoxEndIndex:{configurable:!0},iconBoxStartIndex:{configurable:!0},iconBoxEndIndex:{configurable:!0},featureIndex:{configurable:!0},numGlyphVertices:{configurable:!0},numVerticalGlyphVertices:{configurable:!0},numIconVertices:{configurable:!0},crossTileID:{configurable:!0}};return r.anchorX.get=function(){return this._structArray.int16[this._pos2+0]},r.anchorX.set=function(t){this._structArray.int16[this._pos2+0]=t;},r.anchorY.get=function(){return this._structArray.int16[this._pos2+1]},r.anchorY.set=function(t){this._structArray.int16[this._pos2+1]=t;},r.horizontalPlacedTextSymbolIndex.get=function(){return this._structArray.int16[this._pos2+2]},r.horizontalPlacedTextSymbolIndex.set=function(t){this._structArray.int16[this._pos2+2]=t;},r.verticalPlacedTextSymbolIndex.get=function(){return this._structArray.int16[this._pos2+3]},r.verticalPlacedTextSymbolIndex.set=function(t){this._structArray.int16[this._pos2+3]=t;},r.key.get=function(){return this._structArray.uint16[this._pos2+4]},r.key.set=function(t){this._structArray.uint16[this._pos2+4]=t;},r.textBoxStartIndex.get=function(){return this._structArray.uint16[this._pos2+5]},r.textBoxStartIndex.set=function(t){this._structArray.uint16[this._pos2+5]=t;},r.textBoxEndIndex.get=function(){return this._structArray.uint16[this._pos2+6]},r.textBoxEndIndex.set=function(t){this._structArray.uint16[this._pos2+6]=t;},r.iconBoxStartIndex.get=function(){return this._structArray.uint16[this._pos2+7]},r.iconBoxStartIndex.set=function(t){this._structArray.uint16[this._pos2+7]=t;},r.iconBoxEndIndex.get=function(){return this._structArray.uint16[this._pos2+8]},r.iconBoxEndIndex.set=function(t){this._structArray.uint16[this._pos2+8]=t;},r.featureIndex.get=function(){return this._structArray.uint16[this._pos2+9]},r.featureIndex.set=function(t){this._structArray.uint16[this._pos2+9]=t;},r.numGlyphVertices.get=function(){return this._structArray.uint16[this._pos2+10]},r.numGlyphVertices.set=function(t){this._structArray.uint16[this._pos2+10]=t;},r.numVerticalGlyphVertices.get=function(){return this._structArray.uint16[this._pos2+11]},r.numVerticalGlyphVertices.set=function(t){this._structArray.uint16[this._pos2+11]=t;},r.numIconVertices.get=function(){return this._structArray.uint16[this._pos2+12]},r.numIconVertices.set=function(t){this._structArray.uint16[this._pos2+12]=t;},r.crossTileID.get=function(){return this._structArray.uint32[this._pos4+7]},r.crossTileID.set=function(t){this._structArray.uint32[this._pos4+7]=t;},Object.defineProperties(e.prototype,r),e}(an);En.prototype.size=32;var Fn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.get=function(t){return new En(this,t)},e}(_n);kr("SymbolInstanceArray",Fn);var On=function(t){function e(){t.apply(this,arguments);}t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e;var r={offsetX:{configurable:!0}};return r.offsetX.get=function(){return this._structArray.float32[this._pos4+0]},r.offsetX.set=function(t){this._structArray.float32[this._pos4+0]=t;},Object.defineProperties(e.prototype,r),e}(an);On.prototype.size=4;var Ln=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.getoffsetX=function(t){return this.float32[1*t+0]},e.prototype.get=function(t){return new On(this,t)},e}(wn);kr("GlyphOffsetArray",Ln);var Dn=function(t){function e(){t.apply(this,arguments);}t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e;var r={x:{configurable:!0},y:{configurable:!0},tileUnitDistanceFromAnchor:{configurable:!0}};return r.x.get=function(){return this._structArray.int16[this._pos2+0]},r.x.set=function(t){this._structArray.int16[this._pos2+0]=t;},r.y.get=function(){return this._structArray.int16[this._pos2+1]},r.y.set=function(t){this._structArray.int16[this._pos2+1]=t;},r.tileUnitDistanceFromAnchor.get=function(){return this._structArray.int16[this._pos2+2]},r.tileUnitDistanceFromAnchor.set=function(t){this._structArray.int16[this._pos2+2]=t;},Object.defineProperties(e.prototype,r),e}(an);Dn.prototype.size=6;var jn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.getx=function(t){return this.int16[3*t+0]},e.prototype.gety=function(t){return this.int16[3*t+1]},e.prototype.gettileUnitDistanceFromAnchor=function(t){return this.int16[3*t+2]},e.prototype.get=function(t){return new Dn(this,t)},e}(An);kr("SymbolLineVertexArray",jn);var Un=function(t){function e(){t.apply(this,arguments);}t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e;var r={featureIndex:{configurable:!0},sourceLayerIndex:{configurable:!0},bucketIndex:{configurable:!0}};return r.featureIndex.get=function(){return this._structArray.uint32[this._pos4+0]},r.featureIndex.set=function(t){this._structArray.uint32[this._pos4+0]=t;},r.sourceLayerIndex.get=function(){return this._structArray.uint16[this._pos2+2]},r.sourceLayerIndex.set=function(t){this._structArray.uint16[this._pos2+2]=t;},r.bucketIndex.get=function(){return this._structArray.uint16[this._pos2+3]},r.bucketIndex.set=function(t){this._structArray.uint16[this._pos2+3]=t;},Object.defineProperties(e.prototype,r),e}(an);Un.prototype.size=8;var qn=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.get=function(t){return new Un(this,t)},e}(kn);kr("FeatureIndexArray",qn);var Rn=sn([{name:"a_pos",components:2,type:"Int16"}],4),Nn=Rn.members,Zn=(Rn.size,Rn.alignment,function(t){void 0===t&&(t=[]),this.segments=t;});Zn.prototype.prepareSegment=function(t,e,r){var n=this.segments[this.segments.length-1];return t>Zn.MAX_VERTEX_ARRAY_LENGTH&&b("Max vertices per segment is "+Zn.MAX_VERTEX_ARRAY_LENGTH+": bucket requested "+t),(!n||n.vertexLength+t>Zn.MAX_VERTEX_ARRAY_LENGTH)&&(n={vertexOffset:e.length,primitiveOffset:r.length,vertexLength:0,primitiveLength:0},this.segments.push(n)),n},Zn.prototype.get=function(){return this.segments},Zn.prototype.destroy=function(){for(var t=0,e=this.segments;t<e.length;t+=1){var r=e[t];for(var n in r.vaos)r.vaos[n].destroy();}},Zn.simpleSegment=function(t,e,r,n){return new Zn([{vertexOffset:t,primitiveOffset:e,vertexLength:r,primitiveLength:n,vaos:{}}])},Zn.MAX_VERTEX_ARRAY_LENGTH=Math.pow(2,16)-1,kr("SegmentVector",Zn);var Xn=function(t,e){return 256*(t=l(Math.floor(t),0,255))+(e=l(Math.floor(e),0,255))},Hn=function(){this.ids=[],this.positions=[],this.indexed=!1;};function Gn(t,e,r){var n=t[e];t[e]=t[r],t[r]=n;}Hn.prototype.add=function(t,e,r,n){this.ids.push(t),this.positions.push(e,r,n);},Hn.prototype.getPositions=function(t){for(var e=0,r=this.ids.length-1;e<r;){var n=e+r>>1;this.ids[n]>=t?r=n:e=n+1;}for(var i=[];this.ids[e]===t;){var a=this.positions[3*e],o=this.positions[3*e+1],s=this.positions[3*e+2];i.push({index:a,start:o,end:s}),e++;}return i},Hn.serialize=function(t,e){var r=new Float64Array(t.ids),n=new Uint32Array(t.positions);return function t(e,r,n,i){if(n>=i)return;var a=e[n+i>>1];var o=n-1;var s=i+1;for(;;){do{o++;}while(e[o]<a);do{s--;}while(e[s]>a);if(o>=s)break;Gn(e,o,s),Gn(r,3*o,3*s),Gn(r,3*o+1,3*s+1),Gn(r,3*o+2,3*s+2);}t(e,r,n,s);t(e,r,s+1,i);}(r,n,0,r.length-1),e.push(r.buffer,n.buffer),{ids:r,positions:n}},Hn.deserialize=function(t){var e=new Hn;return e.ids=t.ids,e.positions=t.positions,e.indexed=!0,e},kr("FeaturePositionMap",Hn);var Jn=function(t,e){this.gl=t.gl,this.location=e;},Kn=function(t){function e(e,r){t.call(this,e,r),this.current=0;}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.set=function(t){this.current!==t&&(this.current=t,this.gl.uniform1i(this.location,t));},e}(Jn),Yn=function(t){function e(e,r){t.call(this,e,r),this.current=0;}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.set=function(t){this.current!==t&&(this.current=t,this.gl.uniform1f(this.location,t));},e}(Jn),$n=function(t){function e(e,r){t.call(this,e,r),this.current=[0,0];}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.set=function(t){t[0]===this.current[0]&&t[1]===this.current[1]||(this.current=t,this.gl.uniform2f(this.location,t[0],t[1]));},e}(Jn),Wn=function(t){function e(e,r){t.call(this,e,r),this.current=[0,0,0];}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.set=function(t){t[0]===this.current[0]&&t[1]===this.current[1]&&t[2]===this.current[2]||(this.current=t,this.gl.uniform3f(this.location,t[0],t[1],t[2]));},e}(Jn),Qn=function(t){function e(e,r){t.call(this,e,r),this.current=[0,0,0,0];}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.set=function(t){t[0]===this.current[0]&&t[1]===this.current[1]&&t[2]===this.current[2]&&t[3]===this.current[3]||(this.current=t,this.gl.uniform4f(this.location,t[0],t[1],t[2],t[3]));},e}(Jn),ti=function(t){function e(e,r){t.call(this,e,r),this.current=at.transparent;}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.set=function(t){t.r===this.current.r&&t.g===this.current.g&&t.b===this.current.b&&t.a===this.current.a||(this.current=t,this.gl.uniform4f(this.location,t.r,t.g,t.b,t.a));},e}(Jn),ei=new Float32Array(16),ri=function(t){function e(e,r){t.call(this,e,r),this.current=ei;}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.set=function(t){if(t[12]!==this.current[12]||t[0]!==this.current[0])return this.current=t,void this.gl.uniformMatrix4fv(this.location,!1,t);for(var e=1;e<16;e++)if(t[e]!==this.current[e]){this.current=t,this.gl.uniformMatrix4fv(this.location,!1,t);break}},e}(Jn);function ni(t){return [Xn(255*t.r,255*t.g),Xn(255*t.b,255*t.a)]}var ii=function(t,e,r){this.value=t,this.names=e,this.uniformNames=this.names.map(function(t){return "u_"+t}),this.type=r,this.maxValue=-1/0;};ii.prototype.defines=function(){return this.names.map(function(t){return "#define HAS_UNIFORM_u_"+t})},ii.prototype.setConstantPatternPositions=function(){},ii.prototype.populatePaintArray=function(){},ii.prototype.updatePaintArray=function(){},ii.prototype.upload=function(){},ii.prototype.destroy=function(){},ii.prototype.setUniforms=function(t,e,r,n){e.set(n.constantOr(this.value));},ii.prototype.getBinding=function(t,e){return "color"===this.type?new ti(t,e):new Yn(t,e)},ii.serialize=function(t){var e=t.value,r=t.names,n=t.type;return {value:Sr(e),names:r,type:n}},ii.deserialize=function(t){var e=t.value,r=t.names,n=t.type;return new ii(Br(e),r,n)};var ai=function(t,e,r){this.value=t,this.names=e,this.uniformNames=this.names.map(function(t){return "u_"+t}),this.type=r,this.maxValue=-1/0,this.patternPositions={patternTo:null,patternFrom:null};};ai.prototype.defines=function(){return this.names.map(function(t){return "#define HAS_UNIFORM_u_"+t})},ai.prototype.populatePaintArray=function(){},ai.prototype.updatePaintArray=function(){},ai.prototype.upload=function(){},ai.prototype.destroy=function(){},ai.prototype.setConstantPatternPositions=function(t,e){this.patternPositions.patternTo=t.tlbr,this.patternPositions.patternFrom=e.tlbr;},ai.prototype.setUniforms=function(t,e,r,n,i){var a=this.patternPositions;"u_pattern_to"===i&&a.patternTo&&e.set(a.patternTo),"u_pattern_from"===i&&a.patternFrom&&e.set(a.patternFrom);},ai.prototype.getBinding=function(t,e){return new Qn(t,e)};var oi=function(t,e,r,n){this.expression=t,this.names=e,this.type=r,this.uniformNames=this.names.map(function(t){return "a_"+t}),this.maxValue=-1/0,this.paintVertexAttributes=e.map(function(t){return {name:"a_"+t,type:"Float32",components:"color"===r?2:1,offset:0}}),this.paintVertexArray=new n;};oi.prototype.defines=function(){return []},oi.prototype.setConstantPatternPositions=function(){},oi.prototype.populatePaintArray=function(t,e){var r=this.paintVertexArray,n=r.length;r.reserve(t);var i=this.expression.evaluate(new qr(0),e,{});if("color"===this.type)for(var a=ni(i),o=n;o<t;o++)r.emplaceBack(a[0],a[1]);else{for(var s=n;s<t;s++)r.emplaceBack(i);this.maxValue=Math.max(this.maxValue,i);}},oi.prototype.updatePaintArray=function(t,e,r,n){var i=this.paintVertexArray,a=this.expression.evaluate({zoom:0},r,n);if("color"===this.type)for(var o=ni(a),s=t;s<e;s++)i.emplace(s,o[0],o[1]);else{for(var u=t;u<e;u++)i.emplace(u,a);this.maxValue=Math.max(this.maxValue,a);}},oi.prototype.upload=function(t){this.paintVertexArray&&this.paintVertexArray.arrayBuffer&&(this.paintVertexBuffer&&this.paintVertexBuffer.buffer?this.paintVertexBuffer.updateData(this.paintVertexArray):this.paintVertexBuffer=t.createVertexBuffer(this.paintVertexArray,this.paintVertexAttributes,this.expression.isStateDependent));},oi.prototype.destroy=function(){this.paintVertexBuffer&&this.paintVertexBuffer.destroy();},oi.prototype.setUniforms=function(t,e){e.set(0);},oi.prototype.getBinding=function(t,e){return new Yn(t,e)};var si=function(t,e,r,n,i,a){this.expression=t,this.names=e,this.uniformNames=this.names.map(function(t){return "a_"+t+"_t"}),this.type=r,this.useIntegerZoom=n,this.zoom=i,this.maxValue=-1/0;var o=a;this.paintVertexAttributes=e.map(function(t){return {name:"a_"+t,type:"Float32",components:"color"===r?4:2,offset:0}}),this.paintVertexArray=new o;};si.prototype.defines=function(){return []},si.prototype.setConstantPatternPositions=function(){},si.prototype.populatePaintArray=function(t,e){var r=this.paintVertexArray,n=r.length;r.reserve(t);var i=this.expression.evaluate(new qr(this.zoom),e,{}),a=this.expression.evaluate(new qr(this.zoom+1),e,{});if("color"===this.type)for(var o=ni(i),s=ni(a),u=n;u<t;u++)r.emplaceBack(o[0],o[1],s[0],s[1]);else{for(var p=n;p<t;p++)r.emplaceBack(i,a);this.maxValue=Math.max(this.maxValue,i,a);}},si.prototype.updatePaintArray=function(t,e,r,n){var i=this.paintVertexArray,a=this.expression.evaluate({zoom:this.zoom},r,n),o=this.expression.evaluate({zoom:this.zoom+1},r,n);if("color"===this.type)for(var s=ni(a),u=ni(o),p=t;p<e;p++)i.emplace(p,s[0],s[1],u[0],u[1]);else{for(var l=t;l<e;l++)i.emplace(l,a,o);this.maxValue=Math.max(this.maxValue,a,o);}},si.prototype.upload=function(t){this.paintVertexArray&&this.paintVertexArray.arrayBuffer&&(this.paintVertexBuffer&&this.paintVertexBuffer.buffer?this.paintVertexBuffer.updateData(this.paintVertexArray):this.paintVertexBuffer=t.createVertexBuffer(this.paintVertexArray,this.paintVertexAttributes,this.expression.isStateDependent));},si.prototype.destroy=function(){this.paintVertexBuffer&&this.paintVertexBuffer.destroy();},si.prototype.interpolationFactor=function(t){return this.useIntegerZoom?this.expression.interpolationFactor(Math.floor(t),this.zoom,this.zoom+1):this.expression.interpolationFactor(t,this.zoom,this.zoom+1)},si.prototype.setUniforms=function(t,e,r){e.set(this.interpolationFactor(r.zoom));},si.prototype.getBinding=function(t,e){return new Yn(t,e)};var ui=function(t,e,r,n,i,a,o){this.expression=t,this.names=e,this.type=r,this.uniformNames=this.names.map(function(t){return "a_"+t+"_t"}),this.useIntegerZoom=n,this.zoom=i,this.maxValue=-1/0,this.layerId=o,this.paintVertexAttributes=e.map(function(t){return {name:"a_"+t,type:"Uint16",components:4,offset:0}}),this.zoomInPaintVertexArray=new a,this.zoomOutPaintVertexArray=new a;};ui.prototype.defines=function(){return []},ui.prototype.setConstantPatternPositions=function(){},ui.prototype.populatePaintArray=function(t,e,r){var n=this.zoomInPaintVertexArray,i=this.zoomOutPaintVertexArray,a=this.layerId,o=n.length;if(n.reserve(t),i.reserve(t),r&&e.patterns&&e.patterns[a]){var s=e.patterns[a],u=s.min,p=s.mid,l=s.max,c=r[u],h=r[p],f=r[l];if(!c||!h||!f)return;for(var y=o;y<t;y++)n.emplaceBack(h.tl[0],h.tl[1],h.br[0],h.br[1],c.tl[0],c.tl[1],c.br[0],c.br[1]),i.emplaceBack(h.tl[0],h.tl[1],h.br[0],h.br[1],f.tl[0],f.tl[1],f.br[0],f.br[1]);}},ui.prototype.updatePaintArray=function(t,e,r,n,i){var a=this.zoomInPaintVertexArray,o=this.zoomOutPaintVertexArray,s=this.layerId;if(i&&r.patterns&&r.patterns[s]){var u=r.patterns[s],p=u.min,l=u.mid,c=u.max,h=i[p],f=i[l],y=i[c];if(!h||!f||!y)return;for(var d=t;d<e;d++)a.emplace(d,f.tl[0],f.tl[1],f.br[0],f.br[1],h.tl[0],h.tl[1],h.br[0],h.br[1]),o.emplace(d,f.tl[0],f.tl[1],f.br[0],f.br[1],y.tl[0],y.tl[1],y.br[0],y.br[1]);}},ui.prototype.upload=function(t){this.zoomInPaintVertexArray&&this.zoomInPaintVertexArray.arrayBuffer&&this.zoomOutPaintVertexArray&&this.zoomOutPaintVertexArray.arrayBuffer&&(this.zoomInPaintVertexBuffer=t.createVertexBuffer(this.zoomInPaintVertexArray,this.paintVertexAttributes,this.expression.isStateDependent),this.zoomOutPaintVertexBuffer=t.createVertexBuffer(this.zoomOutPaintVertexArray,this.paintVertexAttributes,this.expression.isStateDependent));},ui.prototype.destroy=function(){this.zoomOutPaintVertexBuffer&&this.zoomOutPaintVertexBuffer.destroy(),this.zoomInPaintVertexBuffer&&this.zoomInPaintVertexBuffer.destroy();},ui.prototype.setUniforms=function(t,e){e.set(0);},ui.prototype.getBinding=function(t,e){return new Yn(t,e)};var pi=function(){this.binders={},this.cacheKey="",this._buffers=[],this._featureMap=new Hn,this._bufferOffset=0;};pi.createDynamic=function(t,e,r){var n=new pi,i=[];for(var a in t.paint._values)if(r(a)){var o=t.paint.get(a);if(o instanceof Jr&&xe(o.property.specification)){var s=ci(a,t.type),u=o.property.specification.type,p=o.property.useIntegerZoom;if("cross-faded"===o.property.specification["property-type"]||"cross-faded-data-driven"===o.property.specification["property-type"])if("constant"===o.value.kind)n.binders[a]=new ai(o.value.value,s,u),i.push("/u_"+a);else{var l=hi(a,u,"source");n.binders[a]=new ui(o.value,s,u,p,e,l,t.id),i.push("/a_"+a);}else if("constant"===o.value.kind)n.binders[a]=new ii(o.value.value,s,u),i.push("/u_"+a);else if("source"===o.value.kind){var c=hi(a,u,"source");n.binders[a]=new oi(o.value,s,u,c),i.push("/a_"+a);}else{var h=hi(a,u,"composite");n.binders[a]=new si(o.value,s,u,p,e,h),i.push("/z_"+a);}}}return n.cacheKey=i.sort().join(""),n},pi.prototype.populatePaintArrays=function(t,e,r,n){for(var i in this.binders){this.binders[i].populatePaintArray(t,e,n);}void 0!==e.id&&this._featureMap.add(+e.id,r,this._bufferOffset,t),this._bufferOffset=t;},pi.prototype.setConstantPatternPositions=function(t,e){for(var r in this.binders){this.binders[r].setConstantPatternPositions(t,e);}},pi.prototype.updatePaintArrays=function(t,e,r,n){var i=!1;for(var a in t)for(var o=0,s=this._featureMap.getPositions(+a);o<s.length;o+=1){var u=s[o],p=e.feature(u.index);for(var l in this.binders){var c=this.binders[l];if(!(c instanceof ii||c instanceof ai)&&!0===c.expression.isStateDependent){var h=r.paint.get(l);c.expression=h.value,c.updatePaintArray(u.start,u.end,p,t[a],n),i=!0;}}}return i},pi.prototype.defines=function(){var t=[];for(var e in this.binders)t.push.apply(t,this.binders[e].defines());return t},pi.prototype.getPaintVertexBuffers=function(){return this._buffers},pi.prototype.getUniforms=function(t,e){var r={};for(var n in this.binders)for(var i=this.binders[n],a=0,o=i.uniformNames;a<o.length;a+=1){var s=o[a];r[s]=i.getBinding(t,e[s]);}return r},pi.prototype.setUniforms=function(t,e,r,n){for(var i in this.binders)for(var a=this.binders[i],o=0,s=a.uniformNames;o<s.length;o+=1){var u=s[o];a.setUniforms(t,e[u],n,r.get(i),u);}},pi.prototype.updatePatternPaintBuffers=function(t){var e=[];for(var r in this.binders){var n=this.binders[r];if(n instanceof ui){var i=2===t.fromScale?n.zoomInPaintVertexBuffer:n.zoomOutPaintVertexBuffer;i&&e.push(i);}else(n instanceof oi||n instanceof si)&&n.paintVertexBuffer&&e.push(n.paintVertexBuffer);}this._buffers=e;},pi.prototype.upload=function(t){for(var e in this.binders)this.binders[e].upload(t);var r=[];for(var n in this.binders){var i=this.binders[n];(i instanceof oi||i instanceof si)&&i.paintVertexBuffer&&r.push(i.paintVertexBuffer);}this._buffers=r;},pi.prototype.destroy=function(){for(var t in this.binders)this.binders[t].destroy();};var li=function(t,e,r,n){void 0===n&&(n=function(){return !0}),this.programConfigurations={};for(var i=0,a=e;i<a.length;i+=1){var o=a[i];this.programConfigurations[o.id]=pi.createDynamic(o,r,n),this.programConfigurations[o.id].layoutAttributes=t;}this.needsUpload=!1;};function ci(t,e){return {"text-opacity":["opacity"],"icon-opacity":["opacity"],"text-color":["fill_color"],"icon-color":["fill_color"],"text-halo-color":["halo_color"],"icon-halo-color":["halo_color"],"text-halo-blur":["halo_blur"],"icon-halo-blur":["halo_blur"],"text-halo-width":["halo_width"],"icon-halo-width":["halo_width"],"line-gap-width":["gapwidth"],"line-pattern":["pattern_to","pattern_from"],"fill-pattern":["pattern_to","pattern_from"],"fill-extrusion-pattern":["pattern_to","pattern_from"]}[t]||[t.replace(e+"-","").replace(/-/g,"_")]}function hi(t,e,r){var n={color:{source:In,composite:Vn},number:{source:wn,composite:In}},i=function(t){return {"line-pattern":{source:fn,composite:fn},"fill-pattern":{source:fn,composite:fn},"fill-extrusion-pattern":{source:fn,composite:fn}}[t]}(t);return i&&i[r]||n[e][r]}li.prototype.populatePaintArrays=function(t,e,r,n){for(var i in this.programConfigurations)this.programConfigurations[i].populatePaintArrays(t,e,r,n);this.needsUpload=!0;},li.prototype.updatePaintArrays=function(t,e,r,n){for(var i=0,a=r;i<a.length;i+=1){var o=a[i];this.needsUpload=this.programConfigurations[o.id].updatePaintArrays(t,e,o,n)||this.needsUpload;}},li.prototype.get=function(t){return this.programConfigurations[t]},li.prototype.upload=function(t){if(this.needsUpload){for(var e in this.programConfigurations)this.programConfigurations[e].upload(t);this.needsUpload=!1;}},li.prototype.destroy=function(){for(var t in this.programConfigurations)this.programConfigurations[t].destroy();},kr("ConstantBinder",ii),kr("CrossFadedConstantBinder",ai),kr("SourceExpressionBinder",oi),kr("CrossFadedCompositeBinder",ui),kr("CompositeExpressionBinder",si),kr("ProgramConfiguration",pi,{omit:["_buffers"]}),kr("ProgramConfigurationSet",li);var fi=8192;var yi,di=(yi=16,{min:-1*Math.pow(2,yi-1),max:Math.pow(2,yi-1)-1});function mi(t){for(var e=fi/t.extent,r=t.loadGeometry(),n=0;n<r.length;n++)for(var i=r[n],a=0;a<i.length;a++){var o=i[a];o.x=Math.round(o.x*e),o.y=Math.round(o.y*e),(o.x<di.min||o.x>di.max||o.y<di.min||o.y>di.max)&&b("Geometry exceeds allowed extent, reduce your vector tile buffer size");}return r}function vi(t,e,r,n,i){t.emplaceBack(2*e+(n+1)/2,2*r+(i+1)/2);}var gi=function(t){this.zoom=t.zoom,this.overscaling=t.overscaling,this.layers=t.layers,this.layerIds=this.layers.map(function(t){return t.id}),this.index=t.index,this.hasPattern=!1,this.layoutVertexArray=new pn,this.indexArray=new zn,this.segments=new Zn,this.programConfigurations=new li(Nn,t.layers,t.zoom);};function xi(t,e,r){for(var n=0;n<t.length;n++){var i=t[n];if(Ii(i,e))return !0;if(zi(e,i,r))return !0}return !1}function bi(t,e){if(1===t.length&&1===t[0].length)return Bi(e,t[0][0]);for(var r=0;r<e.length;r++)for(var n=e[r],i=0;i<n.length;i++)if(Bi(t,n[i]))return !0;for(var a=0;a<t.length;a++){for(var o=t[a],s=0;s<o.length;s++)if(Bi(e,o[s]))return !0;for(var u=0;u<e.length;u++)if(Ai(o,e[u]))return !0}return !1}function _i(t,e,r){for(var n=0;n<e.length;n++)for(var i=e[n],a=0;a<t.length;a++){var o=t[a];if(o.length>=3)for(var s=0;s<i.length;s++)if(Ii(o,i[s]))return !0;if(wi(o,i,r))return !0}return !1}function wi(t,e,r){if(t.length>1){if(Ai(t,e))return !0;for(var n=0;n<e.length;n++)if(zi(e[n],t,r))return !0}for(var i=0;i<t.length;i++)if(zi(t[i],e,r))return !0;return !1}function Ai(t,e){if(0===t.length||0===e.length)return !1;for(var r=0;r<t.length-1;r++)for(var n=t[r],i=t[r+1],a=0;a<e.length-1;a++){if(ki(n,i,e[a],e[a+1]))return !0}return !1}function ki(t,e,r,n){return _(t,r,n)!==_(e,r,n)&&_(t,e,r)!==_(t,e,n)}function zi(t,e,r){var n=r*r;if(1===e.length)return t.distSqr(e[0])<n;for(var i=1;i<e.length;i++){if(Si(t,e[i-1],e[i])<n)return !0}return !1}function Si(t,e,r){var n=e.distSqr(r);if(0===n)return t.distSqr(e);var i=((t.x-e.x)*(r.x-e.x)+(t.y-e.y)*(r.y-e.y))/n;return i<0?t.distSqr(e):i>1?t.distSqr(r):t.distSqr(r.sub(e)._mult(i)._add(e))}function Bi(t,e){for(var r,n,i,a=!1,o=0;o<t.length;o++)for(var s=0,u=(r=t[o]).length-1;s<r.length;u=s++)n=r[s],i=r[u],n.y>e.y!=i.y>e.y&&e.x<(i.x-n.x)*(e.y-n.y)/(i.y-n.y)+n.x&&(a=!a);return a}function Ii(t,e){for(var r=!1,n=0,i=t.length-1;n<t.length;i=n++){var a=t[n],o=t[i];a.y>e.y!=o.y>e.y&&e.x<(o.x-a.x)*(e.y-a.y)/(o.y-a.y)+a.x&&(r=!r);}return r}function Vi(t,e,r){var n=e.paint.get(t).value;return "constant"===n.kind?n.value:r.programConfigurations.get(e.id).binders[t].maxValue}function Pi(t){return Math.sqrt(t[0]*t[0]+t[1]*t[1])}function Mi(t,e,r,n,i){if(!e[0]&&!e[1])return t;var o=a.convert(e);"viewport"===r&&o._rotate(-n);for(var s=[],u=0;u<t.length;u++){for(var p=t[u],l=[],c=0;c<p.length;c++)l.push(p[c].sub(o._mult(i)));s.push(l);}return s}gi.prototype.populate=function(t,e){for(var r=0,n=t;r<n.length;r+=1){var i=n[r],a=i.feature,o=i.index,s=i.sourceLayerIndex;if(this.layers[0]._featureFilter(new qr(this.zoom),a)){var u=mi(a);this.addFeature(a,u,o),e.featureIndex.insert(a,u,o,s,this.index);}}},gi.prototype.update=function(t,e,r){this.stateDependentLayers.length&&this.programConfigurations.updatePaintArrays(t,e,this.stateDependentLayers,r);},gi.prototype.isEmpty=function(){return 0===this.layoutVertexArray.length},gi.prototype.uploadPending=function(){return !this.uploaded||this.programConfigurations.needsUpload},gi.prototype.upload=function(t){this.uploaded||(this.layoutVertexBuffer=t.createVertexBuffer(this.layoutVertexArray,Nn),this.indexBuffer=t.createIndexBuffer(this.indexArray)),this.programConfigurations.upload(t),this.uploaded=!0;},gi.prototype.destroy=function(){this.layoutVertexBuffer&&(this.layoutVertexBuffer.destroy(),this.indexBuffer.destroy(),this.programConfigurations.destroy(),this.segments.destroy());},gi.prototype.addFeature=function(t,e,r){for(var n=0,i=e;n<i.length;n+=1)for(var a=0,o=i[n];a<o.length;a+=1){var s=o[a],u=s.x,p=s.y;if(!(u<0||u>=fi||p<0||p>=fi)){var l=this.segments.prepareSegment(4,this.layoutVertexArray,this.indexArray),c=l.vertexLength;vi(this.layoutVertexArray,u,p,-1,-1),vi(this.layoutVertexArray,u,p,1,-1),vi(this.layoutVertexArray,u,p,1,1),vi(this.layoutVertexArray,u,p,-1,1),this.indexArray.emplaceBack(c,c+1,c+2),this.indexArray.emplaceBack(c,c+3,c+2),l.vertexLength+=4,l.primitiveLength+=2;}}this.programConfigurations.populatePaintArrays(this.layoutVertexArray.length,t,r,{});},kr("CircleBucket",gi,{omit:["layers"]});var Ci={paint:new en({"circle-radius":new $r(L.paint_circle["circle-radius"]),"circle-color":new $r(L.paint_circle["circle-color"]),"circle-blur":new $r(L.paint_circle["circle-blur"]),"circle-opacity":new $r(L.paint_circle["circle-opacity"]),"circle-translate":new Yr(L.paint_circle["circle-translate"]),"circle-translate-anchor":new Yr(L.paint_circle["circle-translate-anchor"]),"circle-pitch-scale":new Yr(L.paint_circle["circle-pitch-scale"]),"circle-pitch-alignment":new Yr(L.paint_circle["circle-pitch-alignment"]),"circle-stroke-width":new $r(L.paint_circle["circle-stroke-width"]),"circle-stroke-color":new $r(L.paint_circle["circle-stroke-color"]),"circle-stroke-opacity":new $r(L.paint_circle["circle-stroke-opacity"])})},Ti="undefined"!=typeof Float32Array?Float32Array:Array;Math.PI;function Ei(){var t=new Ti(9);return t[0]=1,t[1]=0,t[2]=0,t[3]=0,t[4]=1,t[5]=0,t[6]=0,t[7]=0,t[8]=1,t}function Fi(){var t=new Ti(3);return t[0]=0,t[1]=0,t[2]=0,t}function Oi(t){var e=t[0],r=t[1],n=t[2];return Math.sqrt(e*e+r*r+n*n)}function Li(t,e,r){var n=new Ti(3);return n[0]=t,n[1]=e,n[2]=r,n}function Di(t,e){var r=e[0],n=e[1],i=e[2],a=r*r+n*n+i*i;return a>0&&(a=1/Math.sqrt(a),t[0]=e[0]*a,t[1]=e[1]*a,t[2]=e[2]*a),t}function ji(t,e){return t[0]*e[0]+t[1]*e[1]+t[2]*e[2]}function Ui(t,e,r){var n=e[0],i=e[1],a=e[2],o=r[0],s=r[1],u=r[2];return t[0]=i*u-a*s,t[1]=a*o-n*u,t[2]=n*s-i*o,t}var qi,Ri=Oi,Ni=(qi=Fi(),function(t,e,r,n,i,a){var o,s;for(e||(e=3),r||(r=0),s=n?Math.min(n*e+r,t.length):t.length,o=r;o<s;o+=e)qi[0]=t[o],qi[1]=t[o+1],qi[2]=t[o+2],i(qi,qi,a),t[o]=qi[0],t[o+1]=qi[1],t[o+2]=qi[2];return t});function Zi(){var t=new Ti(4);return t[0]=0,t[1]=0,t[2]=0,t[3]=0,t}function Xi(t,e){var r=e[0],n=e[1],i=e[2],a=e[3],o=r*r+n*n+i*i+a*a;return o>0&&(o=1/Math.sqrt(o),t[0]=r*o,t[1]=n*o,t[2]=i*o,t[3]=a*o),t}function Hi(t,e,r){var n=e[0],i=e[1],a=e[2],o=e[3];return t[0]=r[0]*n+r[4]*i+r[8]*a+r[12]*o,t[1]=r[1]*n+r[5]*i+r[9]*a+r[13]*o,t[2]=r[2]*n+r[6]*i+r[10]*a+r[14]*o,t[3]=r[3]*n+r[7]*i+r[11]*a+r[15]*o,t}var Gi=function(){var t=Zi();return function(e,r,n,i,a,o){var s,u;for(r||(r=4),n||(n=0),u=i?Math.min(i*r+n,e.length):e.length,s=n;s<u;s+=r)t[0]=e[s],t[1]=e[s+1],t[2]=e[s+2],t[3]=e[s+3],a(t,t,o),e[s]=t[0],e[s+1]=t[1],e[s+2]=t[2],e[s+3]=t[3];return e}}();function Ji(){var t=new Ti(4);return t[0]=0,t[1]=0,t[2]=0,t[3]=1,t}function Ki(t,e,r,n){var i,a,o,s,u,p=e[0],l=e[1],c=e[2],h=e[3],f=r[0],y=r[1],d=r[2],m=r[3];return (a=p*f+l*y+c*d+h*m)<0&&(a=-a,f=-f,y=-y,d=-d,m=-m),1-a>1e-6?(i=Math.acos(a),o=Math.sin(i),s=Math.sin((1-n)*i)/o,u=Math.sin(n*i)/o):(s=1-n,u=n),t[0]=s*p+u*f,t[1]=s*l+u*y,t[2]=s*c+u*d,t[3]=s*h+u*m,t}var Yi,$i,Wi,Qi,ta,ea,ra=Xi;Yi=Fi(),$i=Li(1,0,0),Wi=Li(0,1,0),Qi=Ji(),ta=Ji(),ea=Ei();!function(){var t,e=((t=new Ti(2))[0]=0,t[1]=0,t);}();var na=function(t){function e(e){t.call(this,e,Ci);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.createBucket=function(t){return new gi(t)},e.prototype.queryRadius=function(t){var e=t;return Vi("circle-radius",this,e)+Vi("circle-stroke-width",this,e)+Pi(this.paint.get("circle-translate"))},e.prototype.queryIntersectsFeature=function(t,e,r,n,i,a,o,s){for(var u=Mi(t,this.paint.get("circle-translate"),this.paint.get("circle-translate-anchor"),a.angle,o),p=this.paint.get("circle-radius").evaluate(e,r)+this.paint.get("circle-stroke-width").evaluate(e,r),l="map"===this.paint.get("circle-pitch-alignment"),c=l?u:function(t,e,r){return t.map(function(t){return t.map(function(t){return ia(t,e,r)})})}(u,s,a),h=l?p*o:p,f=0,y=n;f<y.length;f+=1)for(var d=0,m=y[f];d<m.length;d+=1){var v=m[d],g=l?v:ia(v,s,a),x=h,b=Hi([],[v.x,v.y,0,1],s);if("viewport"===this.paint.get("circle-pitch-scale")&&"map"===this.paint.get("circle-pitch-alignment")?x*=b[3]/a.cameraToCenterDistance:"map"===this.paint.get("circle-pitch-scale")&&"viewport"===this.paint.get("circle-pitch-alignment")&&(x*=a.cameraToCenterDistance/b[3]),xi(c,g,x))return !0}return !1},e}(rn);function ia(t,e,r){var n=Hi([],[t.x,t.y,0,1],e);return new a((n[0]/n[3]+1)*r.width*.5,(n[1]/n[3]+1)*r.height*.5)}var aa=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e}(gi);function oa(t,e,r,n){var i=e.width,a=e.height;if(n){if(n.length!==i*a*r)throw new RangeError("mismatched image size")}else n=new Uint8Array(i*a*r);return t.width=i,t.height=a,t.data=n,t}function sa(t,e,r){var n=e.width,i=e.height;if(n!==t.width||i!==t.height){var a=oa({},{width:n,height:i},r);ua(t,a,{x:0,y:0},{x:0,y:0},{width:Math.min(t.width,n),height:Math.min(t.height,i)},r),t.width=n,t.height=i,t.data=a.data;}}function ua(t,e,r,n,i,a){if(0===i.width||0===i.height)return e;if(i.width>t.width||i.height>t.height||r.x>t.width-i.width||r.y>t.height-i.height)throw new RangeError("out of range source coordinates for image copy");if(i.width>e.width||i.height>e.height||n.x>e.width-i.width||n.y>e.height-i.height)throw new RangeError("out of range destination coordinates for image copy");for(var o=t.data,s=e.data,u=0;u<i.height;u++)for(var p=((r.y+u)*t.width+r.x)*a,l=((n.y+u)*e.width+n.x)*a,c=0;c<i.width*a;c++)s[l+c]=o[p+c];return e}kr("HeatmapBucket",aa,{omit:["layers"]});var pa=function(t,e){oa(this,t,1,e);};pa.prototype.resize=function(t){sa(this,t,1);},pa.prototype.clone=function(){return new pa({width:this.width,height:this.height},new Uint8Array(this.data))},pa.copy=function(t,e,r,n,i){ua(t,e,r,n,i,1);};var la=function(t,e){oa(this,t,4,e);};la.prototype.resize=function(t){sa(this,t,4);},la.prototype.clone=function(){return new la({width:this.width,height:this.height},new Uint8Array(this.data))},la.copy=function(t,e,r,n,i){ua(t,e,r,n,i,4);},kr("AlphaImage",pa),kr("RGBAImage",la);var ca={paint:new en({"heatmap-radius":new $r(L.paint_heatmap["heatmap-radius"]),"heatmap-weight":new $r(L.paint_heatmap["heatmap-weight"]),"heatmap-intensity":new Yr(L.paint_heatmap["heatmap-intensity"]),"heatmap-color":new tn(L.paint_heatmap["heatmap-color"]),"heatmap-opacity":new Yr(L.paint_heatmap["heatmap-opacity"])})};function ha(t,e){for(var r=new Uint8Array(1024),n={},i=0,a=0;i<256;i++,a+=4){n[e]=i/255;var o=t.evaluate(n);r[a+0]=Math.floor(255*o.r/o.a),r[a+1]=Math.floor(255*o.g/o.a),r[a+2]=Math.floor(255*o.b/o.a),r[a+3]=Math.floor(255*o.a);}return new la({width:256,height:1},r)}var fa=function(t){function e(e){t.call(this,e,ca),this._updateColorRamp();}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.createBucket=function(t){return new aa(t)},e.prototype._handleSpecialPaintPropertyUpdate=function(t){"heatmap-color"===t&&this._updateColorRamp();},e.prototype._updateColorRamp=function(){var t=this._transitionablePaint._values["heatmap-color"].value.expression;this.colorRamp=ha(t,"heatmapDensity"),this.colorRampTexture=null;},e.prototype.resize=function(){this.heatmapFbo&&(this.heatmapFbo.destroy(),this.heatmapFbo=null);},e.prototype.queryRadius=function(){return 0},e.prototype.queryIntersectsFeature=function(){return !1},e.prototype.hasOffscreenPass=function(){return 0!==this.paint.get("heatmap-opacity")&&"none"!==this.visibility},e}(rn),ya={paint:new en({"hillshade-illumination-direction":new Yr(L.paint_hillshade["hillshade-illumination-direction"]),"hillshade-illumination-anchor":new Yr(L.paint_hillshade["hillshade-illumination-anchor"]),"hillshade-exaggeration":new Yr(L.paint_hillshade["hillshade-exaggeration"]),"hillshade-shadow-color":new Yr(L.paint_hillshade["hillshade-shadow-color"]),"hillshade-highlight-color":new Yr(L.paint_hillshade["hillshade-highlight-color"]),"hillshade-accent-color":new Yr(L.paint_hillshade["hillshade-accent-color"])})},da=function(t){function e(e){t.call(this,e,ya);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.hasOffscreenPass=function(){return 0!==this.paint.get("hillshade-exaggeration")&&"none"!==this.visibility},e}(rn),ma=sn([{name:"a_pos",components:2,type:"Int16"}],4),va=ma.members,ga=(ma.size,ma.alignment,ba),xa=ba;function ba(t,e,r){r=r||2;var n,i,a,o,s,u,p,l=e&&e.length,c=l?e[0]*r:t.length,h=_a(t,0,c,r,!0),f=[];if(!h)return f;if(l&&(h=function(t,e,r,n){var i,a,o,s,u,p=[];for(i=0,a=e.length;i<a;i++)o=e[i]*n,s=i<a-1?e[i+1]*n:t.length,(u=_a(t,o,s,n,!1))===u.next&&(u.steiner=!0),p.push(Ma(u));for(p.sort(Ia),i=0;i<p.length;i++)Va(p[i],r),r=wa(r,r.next);return r}(t,e,h,r)),t.length>80*r){n=a=t[0],i=o=t[1];for(var y=r;y<c;y+=r)(s=t[y])<n&&(n=s),(u=t[y+1])<i&&(i=u),s>a&&(a=s),u>o&&(o=u);p=0!==(p=Math.max(a-n,o-i))?1/p:0;}return Aa(h,f,r,n,i,p),f}function _a(t,e,r,n,i){var a,o;if(i===Ra(t,e,r,n)>0)for(a=e;a<r;a+=n)o=ja(a,t[a],t[a+1],o);else for(a=r-n;a>=e;a-=n)o=ja(a,t[a],t[a+1],o);return o&&Fa(o,o.next)&&(Ua(o),o=o.next),o}function wa(t,e){if(!t)return t;e||(e=t);var r,n=t;do{if(r=!1,n.steiner||!Fa(n,n.next)&&0!==Ea(n.prev,n,n.next))n=n.next;else{if(Ua(n),(n=e=n.prev)===n.next)break;r=!0;}}while(r||n!==e);return e}function Aa(t,e,r,n,i,a,o){if(t){!o&&a&&function(t,e,r,n){var i=t;do{null===i.z&&(i.z=Pa(i.x,i.y,e,r,n)),i.prevZ=i.prev,i.nextZ=i.next,i=i.next;}while(i!==t);i.prevZ.nextZ=null,i.prevZ=null,function(t){var e,r,n,i,a,o,s,u,p=1;do{for(r=t,t=null,a=null,o=0;r;){for(o++,n=r,s=0,e=0;e<p&&(s++,n=n.nextZ);e++);for(u=p;s>0||u>0&&n;)0!==s&&(0===u||!n||r.z<=n.z)?(i=r,r=r.nextZ,s--):(i=n,n=n.nextZ,u--),a?a.nextZ=i:t=i,i.prevZ=a,a=i;r=n;}a.nextZ=null,p*=2;}while(o>1)}(i);}(t,n,i,a);for(var s,u,p=t;t.prev!==t.next;)if(s=t.prev,u=t.next,a?za(t,n,i,a):ka(t))e.push(s.i/r),e.push(t.i/r),e.push(u.i/r),Ua(t),t=u.next,p=u.next;else if((t=u)===p){o?1===o?Aa(t=Sa(t,e,r),e,r,n,i,a,2):2===o&&Ba(t,e,r,n,i,a):Aa(wa(t),e,r,n,i,a,1);break}}}function ka(t){var e=t.prev,r=t,n=t.next;if(Ea(e,r,n)>=0)return !1;for(var i=t.next.next;i!==t.prev;){if(Ca(e.x,e.y,r.x,r.y,n.x,n.y,i.x,i.y)&&Ea(i.prev,i,i.next)>=0)return !1;i=i.next;}return !0}function za(t,e,r,n){var i=t.prev,a=t,o=t.next;if(Ea(i,a,o)>=0)return !1;for(var s=i.x<a.x?i.x<o.x?i.x:o.x:a.x<o.x?a.x:o.x,u=i.y<a.y?i.y<o.y?i.y:o.y:a.y<o.y?a.y:o.y,p=i.x>a.x?i.x>o.x?i.x:o.x:a.x>o.x?a.x:o.x,l=i.y>a.y?i.y>o.y?i.y:o.y:a.y>o.y?a.y:o.y,c=Pa(s,u,e,r,n),h=Pa(p,l,e,r,n),f=t.prevZ,y=t.nextZ;f&&f.z>=c&&y&&y.z<=h;){if(f!==t.prev&&f!==t.next&&Ca(i.x,i.y,a.x,a.y,o.x,o.y,f.x,f.y)&&Ea(f.prev,f,f.next)>=0)return !1;if(f=f.prevZ,y!==t.prev&&y!==t.next&&Ca(i.x,i.y,a.x,a.y,o.x,o.y,y.x,y.y)&&Ea(y.prev,y,y.next)>=0)return !1;y=y.nextZ;}for(;f&&f.z>=c;){if(f!==t.prev&&f!==t.next&&Ca(i.x,i.y,a.x,a.y,o.x,o.y,f.x,f.y)&&Ea(f.prev,f,f.next)>=0)return !1;f=f.prevZ;}for(;y&&y.z<=h;){if(y!==t.prev&&y!==t.next&&Ca(i.x,i.y,a.x,a.y,o.x,o.y,y.x,y.y)&&Ea(y.prev,y,y.next)>=0)return !1;y=y.nextZ;}return !0}function Sa(t,e,r){var n=t;do{var i=n.prev,a=n.next.next;!Fa(i,a)&&Oa(i,n,n.next,a)&&La(i,a)&&La(a,i)&&(e.push(i.i/r),e.push(n.i/r),e.push(a.i/r),Ua(n),Ua(n.next),n=t=a),n=n.next;}while(n!==t);return n}function Ba(t,e,r,n,i,a){var o=t;do{for(var s=o.next.next;s!==o.prev;){if(o.i!==s.i&&Ta(o,s)){var u=Da(o,s);return o=wa(o,o.next),u=wa(u,u.next),Aa(o,e,r,n,i,a),void Aa(u,e,r,n,i,a)}s=s.next;}o=o.next;}while(o!==t)}function Ia(t,e){return t.x-e.x}function Va(t,e){if(e=function(t,e){var r,n=e,i=t.x,a=t.y,o=-1/0;do{if(a<=n.y&&a>=n.next.y&&n.next.y!==n.y){var s=n.x+(a-n.y)*(n.next.x-n.x)/(n.next.y-n.y);if(s<=i&&s>o){if(o=s,s===i){if(a===n.y)return n;if(a===n.next.y)return n.next}r=n.x<n.next.x?n:n.next;}}n=n.next;}while(n!==e);if(!r)return null;if(i===o)return r.prev;var u,p=r,l=r.x,c=r.y,h=1/0;n=r.next;for(;n!==p;)i>=n.x&&n.x>=l&&i!==n.x&&Ca(a<c?i:o,a,l,c,a<c?o:i,a,n.x,n.y)&&((u=Math.abs(a-n.y)/(i-n.x))<h||u===h&&n.x>r.x)&&La(n,t)&&(r=n,h=u),n=n.next;return r}(t,e)){var r=Da(e,t);wa(r,r.next);}}function Pa(t,e,r,n,i){return (t=1431655765&((t=858993459&((t=252645135&((t=16711935&((t=32767*(t-r)*i)|t<<8))|t<<4))|t<<2))|t<<1))|(e=1431655765&((e=858993459&((e=252645135&((e=16711935&((e=32767*(e-n)*i)|e<<8))|e<<4))|e<<2))|e<<1))<<1}function Ma(t){var e=t,r=t;do{e.x<r.x&&(r=e),e=e.next;}while(e!==t);return r}function Ca(t,e,r,n,i,a,o,s){return (i-o)*(e-s)-(t-o)*(a-s)>=0&&(t-o)*(n-s)-(r-o)*(e-s)>=0&&(r-o)*(a-s)-(i-o)*(n-s)>=0}function Ta(t,e){return t.next.i!==e.i&&t.prev.i!==e.i&&!function(t,e){var r=t;do{if(r.i!==t.i&&r.next.i!==t.i&&r.i!==e.i&&r.next.i!==e.i&&Oa(r,r.next,t,e))return !0;r=r.next;}while(r!==t);return !1}(t,e)&&La(t,e)&&La(e,t)&&function(t,e){var r=t,n=!1,i=(t.x+e.x)/2,a=(t.y+e.y)/2;do{r.y>a!=r.next.y>a&&r.next.y!==r.y&&i<(r.next.x-r.x)*(a-r.y)/(r.next.y-r.y)+r.x&&(n=!n),r=r.next;}while(r!==t);return n}(t,e)}function Ea(t,e,r){return (e.y-t.y)*(r.x-e.x)-(e.x-t.x)*(r.y-e.y)}function Fa(t,e){return t.x===e.x&&t.y===e.y}function Oa(t,e,r,n){return !!(Fa(t,e)&&Fa(r,n)||Fa(t,n)&&Fa(r,e))||Ea(t,e,r)>0!=Ea(t,e,n)>0&&Ea(r,n,t)>0!=Ea(r,n,e)>0}function La(t,e){return Ea(t.prev,t,t.next)<0?Ea(t,e,t.next)>=0&&Ea(t,t.prev,e)>=0:Ea(t,e,t.prev)<0||Ea(t,t.next,e)<0}function Da(t,e){var r=new qa(t.i,t.x,t.y),n=new qa(e.i,e.x,e.y),i=t.next,a=e.prev;return t.next=e,e.prev=t,r.next=i,i.prev=r,n.next=r,r.prev=n,a.next=n,n.prev=a,n}function ja(t,e,r,n){var i=new qa(t,e,r);return n?(i.next=n.next,i.prev=n,n.next.prev=i,n.next=i):(i.prev=i,i.next=i),i}function Ua(t){t.next.prev=t.prev,t.prev.next=t.next,t.prevZ&&(t.prevZ.nextZ=t.nextZ),t.nextZ&&(t.nextZ.prevZ=t.prevZ);}function qa(t,e,r){this.i=t,this.x=e,this.y=r,this.prev=null,this.next=null,this.z=null,this.prevZ=null,this.nextZ=null,this.steiner=!1;}function Ra(t,e,r,n){for(var i=0,a=e,o=r-n;a<r;a+=n)i+=(t[o]-t[a])*(t[a+1]+t[o+1]),o=a;return i}ba.deviation=function(t,e,r,n){var i=e&&e.length,a=i?e[0]*r:t.length,o=Math.abs(Ra(t,0,a,r));if(i)for(var s=0,u=e.length;s<u;s++){var p=e[s]*r,l=s<u-1?e[s+1]*r:t.length;o-=Math.abs(Ra(t,p,l,r));}var c=0;for(s=0;s<n.length;s+=3){var h=n[s]*r,f=n[s+1]*r,y=n[s+2]*r;c+=Math.abs((t[h]-t[y])*(t[f+1]-t[h+1])-(t[h]-t[f])*(t[y+1]-t[h+1]));}return 0===o&&0===c?0:Math.abs((c-o)/o)},ba.flatten=function(t){for(var e=t[0][0].length,r={vertices:[],holes:[],dimensions:e},n=0,i=0;i<t.length;i++){for(var a=0;a<t[i].length;a++)for(var o=0;o<e;o++)r.vertices.push(t[i][a][o]);i>0&&(n+=t[i-1].length,r.holes.push(n));}return r},ga.default=xa;var Na=Xa,Za=Xa;function Xa(t,e,r,n,i){!function t(e,r,n,i,a){for(;i>n;){if(i-n>600){var o=i-n+1,s=r-n+1,u=Math.log(o),p=.5*Math.exp(2*u/3),l=.5*Math.sqrt(u*p*(o-p)/o)*(s-o/2<0?-1:1),c=Math.max(n,Math.floor(r-s*p/o+l)),h=Math.min(i,Math.floor(r+(o-s)*p/o+l));t(e,r,c,h,a);}var f=e[r],y=n,d=i;for(Ha(e,n,r),a(e[i],f)>0&&Ha(e,n,i);y<d;){for(Ha(e,y,d),y++,d--;a(e[y],f)<0;)y++;for(;a(e[d],f)>0;)d--;}0===a(e[n],f)?Ha(e,n,d):Ha(e,++d,i),d<=r&&(n=d+1),r<=d&&(i=d-1);}}(t,e,r||0,n||t.length-1,i||Ga);}function Ha(t,e,r){var n=t[e];t[e]=t[r],t[r]=n;}function Ga(t,e){return t<e?-1:t>e?1:0}function Ja(t,e){var r=t.length;if(r<=1)return [t];for(var n,i,a=[],o=0;o<r;o++){var s=w(t[o]);0!==s&&(t[o].area=Math.abs(s),void 0===i&&(i=s<0),i===s<0?(n&&a.push(n),n=[t[o]]):n.push(t[o]));}if(n&&a.push(n),e>1)for(var u=0;u<a.length;u++)a[u].length<=e||(Na(a[u],e,1,a[u].length-1,Ka),a[u]=a[u].slice(0,e));return a}function Ka(t,e){return e.area-t.area}function Ya(t,e,r){for(var n=r.patternDependencies,i=!1,a=0,o=e;a<o.length;a+=1){var s=o[a].paint.get(t+"-pattern");s.isConstant()||(i=!0);var u=s.constantOr(null);u&&(i=!0,n[u.to]=!0,n[u.from]=!0);}return i}function $a(t,e,r,n,i){for(var a=i.patternDependencies,o=0,s=e;o<s.length;o+=1){var u=s[o],p=u.paint.get(t+"-pattern").value;if("constant"!==p.kind){var l=p.evaluate({zoom:n-1},r,{}),c=p.evaluate({zoom:n},r,{}),h=p.evaluate({zoom:n+1},r,{});a[l]=!0,a[c]=!0,a[h]=!0,r.patterns[u.id]={min:l,mid:c,max:h};}}return r}Na.default=Za;var Wa=function(t){this.zoom=t.zoom,this.overscaling=t.overscaling,this.layers=t.layers,this.layerIds=this.layers.map(function(t){return t.id}),this.index=t.index,this.hasPattern=!1,this.layoutVertexArray=new pn,this.indexArray=new zn,this.indexArray2=new Sn,this.programConfigurations=new li(va,t.layers,t.zoom),this.segments=new Zn,this.segments2=new Zn;};Wa.prototype.populate=function(t,e){this.features=[],this.hasPattern=Ya("fill",this.layers,e);for(var r=0,n=t;r<n.length;r+=1){var i=n[r],a=i.feature,o=i.index,s=i.sourceLayerIndex;if(this.layers[0]._featureFilter(new qr(this.zoom),a)){var u=mi(a),p={sourceLayerIndex:s,index:o,geometry:u,properties:a.properties,type:a.type,patterns:{}};void 0!==a.id&&(p.id=a.id),this.hasPattern?this.features.push($a("fill",this.layers,p,this.zoom,e)):this.addFeature(p,u,o,{}),e.featureIndex.insert(a,u,o,s,this.index);}}},Wa.prototype.update=function(t,e,r){this.stateDependentLayers.length&&this.programConfigurations.updatePaintArrays(t,e,this.stateDependentLayers,r);},Wa.prototype.addFeatures=function(t,e){for(var r=0,n=this.features;r<n.length;r+=1){var i=n[r],a=i.geometry;this.addFeature(i,a,i.index,e);}},Wa.prototype.isEmpty=function(){return 0===this.layoutVertexArray.length},Wa.prototype.uploadPending=function(){return !this.uploaded||this.programConfigurations.needsUpload},Wa.prototype.upload=function(t){this.uploaded||(this.layoutVertexBuffer=t.createVertexBuffer(this.layoutVertexArray,va),this.indexBuffer=t.createIndexBuffer(this.indexArray),this.indexBuffer2=t.createIndexBuffer(this.indexArray2)),this.programConfigurations.upload(t),this.uploaded=!0;},Wa.prototype.destroy=function(){this.layoutVertexBuffer&&(this.layoutVertexBuffer.destroy(),this.indexBuffer.destroy(),this.indexBuffer2.destroy(),this.programConfigurations.destroy(),this.segments.destroy(),this.segments2.destroy());},Wa.prototype.addFeature=function(t,e,r,n){for(var i=0,a=Ja(e,500);i<a.length;i+=1){for(var o=a[i],s=0,u=0,p=o;u<p.length;u+=1){s+=p[u].length;}for(var l=this.segments.prepareSegment(s,this.layoutVertexArray,this.indexArray),c=l.vertexLength,h=[],f=[],y=0,d=o;y<d.length;y+=1){var m=d[y];if(0!==m.length){m!==o[0]&&f.push(h.length/2);var v=this.segments2.prepareSegment(m.length,this.layoutVertexArray,this.indexArray2),g=v.vertexLength;this.layoutVertexArray.emplaceBack(m[0].x,m[0].y),this.indexArray2.emplaceBack(g+m.length-1,g),h.push(m[0].x),h.push(m[0].y);for(var x=1;x<m.length;x++)this.layoutVertexArray.emplaceBack(m[x].x,m[x].y),this.indexArray2.emplaceBack(g+x-1,g+x),h.push(m[x].x),h.push(m[x].y);v.vertexLength+=m.length,v.primitiveLength+=m.length;}}for(var b=ga(h,f),_=0;_<b.length;_+=3)this.indexArray.emplaceBack(c+b[_],c+b[_+1],c+b[_+2]);l.vertexLength+=s,l.primitiveLength+=b.length/3;}this.programConfigurations.populatePaintArrays(this.layoutVertexArray.length,t,r,n);},kr("FillBucket",Wa,{omit:["layers","features"]});var Qa={paint:new en({"fill-antialias":new Yr(L.paint_fill["fill-antialias"]),"fill-opacity":new $r(L.paint_fill["fill-opacity"]),"fill-color":new $r(L.paint_fill["fill-color"]),"fill-outline-color":new $r(L.paint_fill["fill-outline-color"]),"fill-translate":new Yr(L.paint_fill["fill-translate"]),"fill-translate-anchor":new Yr(L.paint_fill["fill-translate-anchor"]),"fill-pattern":new Wr(L.paint_fill["fill-pattern"])})},to=function(t){function e(e){t.call(this,e,Qa);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.recalculate=function(e){t.prototype.recalculate.call(this,e);var r=this.paint._values["fill-outline-color"];"constant"===r.value.kind&&void 0===r.value.value&&(this.paint._values["fill-outline-color"]=this.paint._values["fill-color"]);},e.prototype.createBucket=function(t){return new Wa(t)},e.prototype.queryRadius=function(){return Pi(this.paint.get("fill-translate"))},e.prototype.queryIntersectsFeature=function(t,e,r,n,i,a,o){return bi(Mi(t,this.paint.get("fill-translate"),this.paint.get("fill-translate-anchor"),a.angle,o),n)},e}(rn),eo=sn([{name:"a_pos",components:2,type:"Int16"},{name:"a_normal_ed",components:4,type:"Int16"}],4),ro=eo.members,no=(eo.size,eo.alignment,Math.pow(2,13));function io(t,e,r,n,i,a,o,s){t.emplaceBack(e,r,2*Math.floor(n*no)+o,i*no*2,a*no*2,Math.round(s));}var ao=function(t){this.zoom=t.zoom,this.overscaling=t.overscaling,this.layers=t.layers,this.layerIds=this.layers.map(function(t){return t.id}),this.index=t.index,this.hasPattern=!1,this.layoutVertexArray=new cn,this.indexArray=new zn,this.programConfigurations=new li(ro,t.layers,t.zoom),this.segments=new Zn;};function oo(t,e){return t.x===e.x&&(t.x<0||t.x>fi)||t.y===e.y&&(t.y<0||t.y>fi)}function so(t){return t.every(function(t){return t.x<0})||t.every(function(t){return t.x>fi})||t.every(function(t){return t.y<0})||t.every(function(t){return t.y>fi})}ao.prototype.populate=function(t,e){this.features=[],this.hasPattern=Ya("fill-extrusion",this.layers,e);for(var r=0,n=t;r<n.length;r+=1){var i=n[r],a=i.feature,o=i.index,s=i.sourceLayerIndex;if(this.layers[0]._featureFilter(new qr(this.zoom),a)){var u=mi(a),p={sourceLayerIndex:s,index:o,geometry:u,properties:a.properties,type:a.type,patterns:{}};void 0!==a.id&&(p.id=a.id),this.hasPattern?this.features.push($a("fill-extrusion",this.layers,p,this.zoom,e)):this.addFeature(p,u,o,{}),e.featureIndex.insert(a,u,o,s,this.index);}}},ao.prototype.addFeatures=function(t,e){for(var r=0,n=this.features;r<n.length;r+=1){var i=n[r],a=i.geometry;this.addFeature(i,a,i.index,e);}},ao.prototype.update=function(t,e,r){this.stateDependentLayers.length&&this.programConfigurations.updatePaintArrays(t,e,this.stateDependentLayers,r);},ao.prototype.isEmpty=function(){return 0===this.layoutVertexArray.length},ao.prototype.uploadPending=function(){return !this.uploaded||this.programConfigurations.needsUpload},ao.prototype.upload=function(t){this.uploaded||(this.layoutVertexBuffer=t.createVertexBuffer(this.layoutVertexArray,ro),this.indexBuffer=t.createIndexBuffer(this.indexArray)),this.programConfigurations.upload(t),this.uploaded=!0;},ao.prototype.destroy=function(){this.layoutVertexBuffer&&(this.layoutVertexBuffer.destroy(),this.indexBuffer.destroy(),this.programConfigurations.destroy(),this.segments.destroy());},ao.prototype.addFeature=function(t,e,r,n){for(var i=0,a=Ja(e,500);i<a.length;i+=1){for(var o=a[i],s=0,u=0,p=o;u<p.length;u+=1){s+=p[u].length;}for(var l=this.segments.prepareSegment(4,this.layoutVertexArray,this.indexArray),c=0,h=o;c<h.length;c+=1){var f=h[c];if(0!==f.length&&!so(f))for(var y=0,d=0;d<f.length;d++){var m=f[d];if(d>=1){var v=f[d-1];if(!oo(m,v)){l.vertexLength+4>Zn.MAX_VERTEX_ARRAY_LENGTH&&(l=this.segments.prepareSegment(4,this.layoutVertexArray,this.indexArray));var g=m.sub(v)._perp()._unit(),x=v.dist(m);y+x>32768&&(y=0),io(this.layoutVertexArray,m.x,m.y,g.x,g.y,0,0,y),io(this.layoutVertexArray,m.x,m.y,g.x,g.y,0,1,y),y+=x,io(this.layoutVertexArray,v.x,v.y,g.x,g.y,0,0,y),io(this.layoutVertexArray,v.x,v.y,g.x,g.y,0,1,y);var b=l.vertexLength;this.indexArray.emplaceBack(b,b+1,b+2),this.indexArray.emplaceBack(b+1,b+2,b+3),l.vertexLength+=4,l.primitiveLength+=2;}}}}l.vertexLength+s>Zn.MAX_VERTEX_ARRAY_LENGTH&&(l=this.segments.prepareSegment(s,this.layoutVertexArray,this.indexArray));for(var _=[],w=[],A=l.vertexLength,k=0,z=o;k<z.length;k+=1){var S=z[k];if(0!==S.length){S!==o[0]&&w.push(_.length/2);for(var B=0;B<S.length;B++){var I=S[B];io(this.layoutVertexArray,I.x,I.y,0,0,1,1,0),_.push(I.x),_.push(I.y);}}}for(var V=ga(_,w),P=0;P<V.length;P+=3)this.indexArray.emplaceBack(A+V[P],A+V[P+1],A+V[P+2]);l.primitiveLength+=V.length/3,l.vertexLength+=s;}this.programConfigurations.populatePaintArrays(this.layoutVertexArray.length,t,r,n);},kr("FillExtrusionBucket",ao,{omit:["layers","features"]});var uo={paint:new en({"fill-extrusion-opacity":new Yr(L["paint_fill-extrusion"]["fill-extrusion-opacity"]),"fill-extrusion-color":new $r(L["paint_fill-extrusion"]["fill-extrusion-color"]),"fill-extrusion-translate":new Yr(L["paint_fill-extrusion"]["fill-extrusion-translate"]),"fill-extrusion-translate-anchor":new Yr(L["paint_fill-extrusion"]["fill-extrusion-translate-anchor"]),"fill-extrusion-pattern":new Wr(L["paint_fill-extrusion"]["fill-extrusion-pattern"]),"fill-extrusion-height":new $r(L["paint_fill-extrusion"]["fill-extrusion-height"]),"fill-extrusion-base":new $r(L["paint_fill-extrusion"]["fill-extrusion-base"])})},po=function(t){function e(e){t.call(this,e,uo);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.createBucket=function(t){return new ao(t)},e.prototype.queryRadius=function(){return Pi(this.paint.get("fill-extrusion-translate"))},e.prototype.queryIntersectsFeature=function(t,e,r,n,i,a,o){return bi(Mi(t,this.paint.get("fill-extrusion-translate"),this.paint.get("fill-extrusion-translate-anchor"),a.angle,o),n)},e.prototype.hasOffscreenPass=function(){return 0!==this.paint.get("fill-extrusion-opacity")&&"none"!==this.visibility},e.prototype.resize=function(){this.viewportFrame&&(this.viewportFrame.destroy(),this.viewportFrame=null);},e}(rn),lo=sn([{name:"a_pos_normal",components:4,type:"Int16"},{name:"a_data",components:4,type:"Uint8"}],4),co=lo.members,ho=(lo.size,lo.alignment,fo);function fo(t,e,r,n,i){this.properties={},this.extent=r,this.type=0,this._pbf=t,this._geometry=-1,this._keys=n,this._values=i,t.readFields(yo,this,e);}function yo(t,e,r){1==t?e.id=r.readVarint():2==t?function(t,e){var r=t.readVarint()+t.pos;for(;t.pos<r;){var n=e._keys[t.readVarint()],i=e._values[t.readVarint()];e.properties[n]=i;}}(r,e):3==t?e.type=r.readVarint():4==t&&(e._geometry=r.pos);}function mo(t){for(var e,r,n=0,i=0,a=t.length,o=a-1;i<a;o=i++)e=t[i],n+=((r=t[o]).x-e.x)*(e.y+r.y);return n}fo.types=["Unknown","Point","LineString","Polygon"],fo.prototype.loadGeometry=function(){var t=this._pbf;t.pos=this._geometry;for(var e,r=t.readVarint()+t.pos,n=1,i=0,o=0,s=0,u=[];t.pos<r;){if(i<=0){var p=t.readVarint();n=7&p,i=p>>3;}if(i--,1===n||2===n)o+=t.readSVarint(),s+=t.readSVarint(),1===n&&(e&&u.push(e),e=[]),e.push(new a(o,s));else{if(7!==n)throw new Error("unknown command "+n);e&&e.push(e[0].clone());}}return e&&u.push(e),u},fo.prototype.bbox=function(){var t=this._pbf;t.pos=this._geometry;for(var e=t.readVarint()+t.pos,r=1,n=0,i=0,a=0,o=1/0,s=-1/0,u=1/0,p=-1/0;t.pos<e;){if(n<=0){var l=t.readVarint();r=7&l,n=l>>3;}if(n--,1===r||2===r)(i+=t.readSVarint())<o&&(o=i),i>s&&(s=i),(a+=t.readSVarint())<u&&(u=a),a>p&&(p=a);else if(7!==r)throw new Error("unknown command "+r)}return [o,u,s,p]},fo.prototype.toGeoJSON=function(t,e,r){var n,i,a=this.extent*Math.pow(2,r),o=this.extent*t,s=this.extent*e,u=this.loadGeometry(),p=fo.types[this.type];function l(t){for(var e=0;e<t.length;e++){var r=t[e],n=180-360*(r.y+s)/a;t[e]=[360*(r.x+o)/a-180,360/Math.PI*Math.atan(Math.exp(n*Math.PI/180))-90];}}switch(this.type){case 1:var c=[];for(n=0;n<u.length;n++)c[n]=u[n][0];l(u=c);break;case 2:for(n=0;n<u.length;n++)l(u[n]);break;case 3:for(u=function(t){var e=t.length;if(e<=1)return [t];for(var r,n,i=[],a=0;a<e;a++){var o=mo(t[a]);0!==o&&(void 0===n&&(n=o<0),n===o<0?(r&&i.push(r),r=[t[a]]):r.push(t[a]));}r&&i.push(r);return i}(u),n=0;n<u.length;n++)for(i=0;i<u[n].length;i++)l(u[n][i]);}1===u.length?u=u[0]:p="Multi"+p;var h={type:"Feature",geometry:{type:p,coordinates:u},properties:this.properties};return "id"in this&&(h.id=this.id),h};var vo=go;function go(t,e){this.version=1,this.name=null,this.extent=4096,this.length=0,this._pbf=t,this._keys=[],this._values=[],this._features=[],t.readFields(xo,this,e),this.length=this._features.length;}function xo(t,e,r){15===t?e.version=r.readVarint():1===t?e.name=r.readString():5===t?e.extent=r.readVarint():2===t?e._features.push(r.pos):3===t?e._keys.push(r.readString()):4===t&&e._values.push(function(t){var e=null,r=t.readVarint()+t.pos;for(;t.pos<r;){var n=t.readVarint()>>3;e=1===n?t.readString():2===n?t.readFloat():3===n?t.readDouble():4===n?t.readVarint64():5===n?t.readVarint():6===n?t.readSVarint():7===n?t.readBoolean():null;}return e}(r));}function bo(t,e,r){if(3===t){var n=new vo(r,r.readVarint()+r.pos);n.length&&(e[n.name]=n);}}go.prototype.feature=function(t){if(t<0||t>=this._features.length)throw new Error("feature index out of bounds");this._pbf.pos=this._features[t];var e=this._pbf.readVarint()+this._pbf.pos;return new ho(this._pbf,e,this.extent,this._keys,this._values)};var _o={VectorTile:function(t,e){this.layers=t.readFields(bo,{},e);},VectorTileFeature:ho,VectorTileLayer:vo},wo=_o.VectorTileFeature.types,Ao=63,ko=Math.cos(Math.PI/180*37.5),zo=.5,So=Math.pow(2,14)/zo;function Bo(t,e,r,n,i,a,o){t.emplaceBack(e.x,e.y,n?1:0,i?1:-1,Math.round(Ao*r.x)+128,Math.round(Ao*r.y)+128,1+(0===a?0:a<0?-1:1)|(o*zo&63)<<2,o*zo>>6);}var Io=function(t){this.zoom=t.zoom,this.overscaling=t.overscaling,this.layers=t.layers,this.layerIds=this.layers.map(function(t){return t.id}),this.index=t.index,this.features=[],this.hasPattern=!1,this.layoutVertexArray=new hn,this.indexArray=new zn,this.programConfigurations=new li(co,t.layers,t.zoom),this.segments=new Zn;};function Vo(t,e){return (t/e.tileTotal*(e.end-e.start)+e.start)*(So-1)}Io.prototype.populate=function(t,e){this.features=[],this.hasPattern=Ya("line",this.layers,e);for(var r=0,n=t;r<n.length;r+=1){var i=n[r],a=i.feature,o=i.index,s=i.sourceLayerIndex;if(this.layers[0]._featureFilter(new qr(this.zoom),a)){var u=mi(a),p={sourceLayerIndex:s,index:o,geometry:u,properties:a.properties,type:a.type,patterns:{}};void 0!==a.id&&(p.id=a.id),this.hasPattern?this.features.push($a("line",this.layers,p,this.zoom,e)):this.addFeature(p,u,o,{}),e.featureIndex.insert(a,u,o,s,this.index);}}},Io.prototype.update=function(t,e,r){this.stateDependentLayers.length&&this.programConfigurations.updatePaintArrays(t,e,this.stateDependentLayers,r);},Io.prototype.addFeatures=function(t,e){for(var r=0,n=this.features;r<n.length;r+=1){var i=n[r],a=i.geometry;this.addFeature(i,a,i.index,e);}},Io.prototype.isEmpty=function(){return 0===this.layoutVertexArray.length},Io.prototype.uploadPending=function(){return !this.uploaded||this.programConfigurations.needsUpload},Io.prototype.upload=function(t){this.uploaded||(this.layoutVertexBuffer=t.createVertexBuffer(this.layoutVertexArray,co),this.indexBuffer=t.createIndexBuffer(this.indexArray)),this.programConfigurations.upload(t),this.uploaded=!0;},Io.prototype.destroy=function(){this.layoutVertexBuffer&&(this.layoutVertexBuffer.destroy(),this.indexBuffer.destroy(),this.programConfigurations.destroy(),this.segments.destroy());},Io.prototype.addFeature=function(t,e,r,n){for(var i=this.layers[0].layout,a=i.get("line-join").evaluate(t,{}),o=i.get("line-cap"),s=i.get("line-miter-limit"),u=i.get("line-round-limit"),p=0,l=e;p<l.length;p+=1){var c=l[p];this.addLine(c,t,a,o,s,u,r,n);}},Io.prototype.addLine=function(t,e,r,n,i,a,o,s){var u=null;e.properties&&e.properties.hasOwnProperty("mapbox_clip_start")&&e.properties.hasOwnProperty("mapbox_clip_end")&&(u={start:e.properties.mapbox_clip_start,end:e.properties.mapbox_clip_end,tileTotal:void 0});for(var p="Polygon"===wo[e.type],l=t.length;l>=2&&t[l-1].equals(t[l-2]);)l--;for(var c=0;c<l-1&&t[c].equals(t[c+1]);)c++;if(!(l<(p?3:2))){u&&(u.tileTotal=function(t,e,r){for(var n,i,a=0,o=e;o<r-1;o++)n=t[o],i=t[o+1],a+=n.dist(i);return a}(t,c,l)),"bevel"===r&&(i=1.05);var h=fi/(512*this.overscaling)*15,f=t[c],y=this.segments.prepareSegment(10*l,this.layoutVertexArray,this.indexArray);this.distance=0;var d,m,v,g=n,x=p?"butt":n,b=!0,_=void 0,w=void 0,A=void 0,k=void 0;this.e1=this.e2=this.e3=-1,p&&(d=t[l-2],k=f.sub(d)._unit()._perp());for(var z=c;z<l;z++)if(!(w=p&&z===l-1?t[c+1]:t[z+1])||!t[z].equals(w)){k&&(A=k),d&&(_=d),d=t[z],k=w?w.sub(d)._unit()._perp():A;var S=(A=A||k).add(k);0===S.x&&0===S.y||S._unit();var B=S.x*k.x+S.y*k.y,I=0!==B?1/B:1/0,V=B<ko&&_&&w;if(V&&z>c){var P=d.dist(_);if(P>2*h){var M=d.sub(d.sub(_)._mult(h/P)._round());this.distance+=M.dist(_),this.addCurrentVertex(M,this.distance,A.mult(1),0,0,!1,y,u),_=M;}}var C=_&&w,T=C?r:w?g:x;if(C&&"round"===T&&(I<a?T="miter":I<=2&&(T="fakeround")),"miter"===T&&I>i&&(T="bevel"),"bevel"===T&&(I>2&&(T="flipbevel"),I<i&&(T="miter")),_&&(this.distance+=d.dist(_)),"miter"===T)S._mult(I),this.addCurrentVertex(d,this.distance,S,0,0,!1,y,u);else if("flipbevel"===T){if(I>100)S=k.clone().mult(-1);else{var E=A.x*k.y-A.y*k.x>0?-1:1,F=I*A.add(k).mag()/A.sub(k).mag();S._perp()._mult(F*E);}this.addCurrentVertex(d,this.distance,S,0,0,!1,y,u),this.addCurrentVertex(d,this.distance,S.mult(-1),0,0,!1,y,u);}else if("bevel"===T||"fakeround"===T){var O=A.x*k.y-A.y*k.x>0,L=-Math.sqrt(I*I-1);if(O?(v=0,m=L):(m=0,v=L),b||this.addCurrentVertex(d,this.distance,A,m,v,!1,y,u),"fakeround"===T){for(var D=Math.floor(8*(.5-(B-.5))),j=void 0,U=0;U<D;U++)j=k.mult((U+1)/(D+1))._add(A)._unit(),this.addPieSliceVertex(d,this.distance,j,O,y,u);this.addPieSliceVertex(d,this.distance,S,O,y,u);for(var q=D-1;q>=0;q--)j=A.mult((q+1)/(D+1))._add(k)._unit(),this.addPieSliceVertex(d,this.distance,j,O,y,u);}w&&this.addCurrentVertex(d,this.distance,k,-m,-v,!1,y,u);}else"butt"===T?(b||this.addCurrentVertex(d,this.distance,A,0,0,!1,y,u),w&&this.addCurrentVertex(d,this.distance,k,0,0,!1,y,u)):"square"===T?(b||(this.addCurrentVertex(d,this.distance,A,1,1,!1,y,u),this.e1=this.e2=-1),w&&this.addCurrentVertex(d,this.distance,k,-1,-1,!1,y,u)):"round"===T&&(b||(this.addCurrentVertex(d,this.distance,A,0,0,!1,y,u),this.addCurrentVertex(d,this.distance,A,1,1,!0,y,u),this.e1=this.e2=-1),w&&(this.addCurrentVertex(d,this.distance,k,-1,-1,!0,y,u),this.addCurrentVertex(d,this.distance,k,0,0,!1,y,u)));if(V&&z<l-1){var R=d.dist(w);if(R>2*h){var N=d.add(w.sub(d)._mult(h/R)._round());this.distance+=N.dist(d),this.addCurrentVertex(N,this.distance,k.mult(1),0,0,!1,y,u),d=N;}}b=!1;}this.programConfigurations.populatePaintArrays(this.layoutVertexArray.length,e,o,s);}},Io.prototype.addCurrentVertex=function(t,e,r,n,i,a,o,s){var u,p=this.layoutVertexArray,l=this.indexArray;s&&(e=Vo(e,s)),u=r.clone(),n&&u._sub(r.perp()._mult(n)),Bo(p,t,u,a,!1,n,e),this.e3=o.vertexLength++,this.e1>=0&&this.e2>=0&&(l.emplaceBack(this.e1,this.e2,this.e3),o.primitiveLength++),this.e1=this.e2,this.e2=this.e3,u=r.mult(-1),i&&u._sub(r.perp()._mult(i)),Bo(p,t,u,a,!0,-i,e),this.e3=o.vertexLength++,this.e1>=0&&this.e2>=0&&(l.emplaceBack(this.e1,this.e2,this.e3),o.primitiveLength++),this.e1=this.e2,this.e2=this.e3,e>So/2&&!s&&(this.distance=0,this.addCurrentVertex(t,this.distance,r,n,i,a,o));},Io.prototype.addPieSliceVertex=function(t,e,r,n,i,a){r=r.mult(n?-1:1);var o=this.layoutVertexArray,s=this.indexArray;a&&(e=Vo(e,a)),Bo(o,t,r,!1,n,0,e),this.e3=i.vertexLength++,this.e1>=0&&this.e2>=0&&(s.emplaceBack(this.e1,this.e2,this.e3),i.primitiveLength++),n?this.e2=this.e3:this.e1=this.e3;},kr("LineBucket",Io,{omit:["layers","features"]});var Po=new en({"line-cap":new Yr(L.layout_line["line-cap"]),"line-join":new $r(L.layout_line["line-join"]),"line-miter-limit":new Yr(L.layout_line["line-miter-limit"]),"line-round-limit":new Yr(L.layout_line["line-round-limit"])}),Mo={paint:new en({"line-opacity":new $r(L.paint_line["line-opacity"]),"line-color":new $r(L.paint_line["line-color"]),"line-translate":new Yr(L.paint_line["line-translate"]),"line-translate-anchor":new Yr(L.paint_line["line-translate-anchor"]),"line-width":new $r(L.paint_line["line-width"]),"line-gap-width":new $r(L.paint_line["line-gap-width"]),"line-offset":new $r(L.paint_line["line-offset"]),"line-blur":new $r(L.paint_line["line-blur"]),"line-dasharray":new Qr(L.paint_line["line-dasharray"]),"line-pattern":new Wr(L.paint_line["line-pattern"]),"line-gradient":new tn(L.paint_line["line-gradient"])}),layout:Po},Co=new(function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.possiblyEvaluate=function(e,r){return r=new qr(Math.floor(r.zoom),{now:r.now,fadeDuration:r.fadeDuration,zoomHistory:r.zoomHistory,transition:r.transition}),t.prototype.possiblyEvaluate.call(this,e,r)},e.prototype.evaluate=function(e,r,n,i){return r=c({},r,{zoom:Math.floor(r.zoom)}),t.prototype.evaluate.call(this,e,r,n,i)},e}($r))(Mo.paint.properties["line-width"].specification);Co.useIntegerZoom=!0;var To=function(t){function e(e){t.call(this,e,Mo);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype._handleSpecialPaintPropertyUpdate=function(t){"line-gradient"===t&&this._updateGradient();},e.prototype._updateGradient=function(){var t=this._transitionablePaint._values["line-gradient"].value.expression;this.gradient=ha(t,"lineProgress"),this.gradientTexture=null;},e.prototype.recalculate=function(e){t.prototype.recalculate.call(this,e),this.paint._values["line-floorwidth"]=Co.possiblyEvaluate(this._transitioningPaint._values["line-width"].value,e);},e.prototype.createBucket=function(t){return new Io(t)},e.prototype.queryRadius=function(t){var e=t,r=Eo(Vi("line-width",this,e),Vi("line-gap-width",this,e)),n=Vi("line-offset",this,e);return r/2+Math.abs(n)+Pi(this.paint.get("line-translate"))},e.prototype.queryIntersectsFeature=function(t,e,r,n,i,o,s){var u=Mi(t,this.paint.get("line-translate"),this.paint.get("line-translate-anchor"),o.angle,s),p=s/2*Eo(this.paint.get("line-width").evaluate(e,r),this.paint.get("line-gap-width").evaluate(e,r)),l=this.paint.get("line-offset").evaluate(e,r);return l&&(n=function(t,e){for(var r=[],n=new a(0,0),i=0;i<t.length;i++){for(var o=t[i],s=[],u=0;u<o.length;u++){var p=o[u-1],l=o[u],c=o[u+1],h=0===u?n:l.sub(p)._unit()._perp(),f=u===o.length-1?n:c.sub(l)._unit()._perp(),y=h._add(f)._unit(),d=y.x*f.x+y.y*f.y;y._mult(1/d),s.push(y._mult(e)._add(l));}r.push(s);}return r}(n,l*s)),_i(u,n,p)},e}(rn);function Eo(t,e){return e>0?e+2*t:t}var Fo=sn([{name:"a_pos_offset",components:4,type:"Int16"},{name:"a_data",components:4,type:"Uint16"}]),Oo=sn([{name:"a_projected_pos",components:3,type:"Float32"}],4),Lo=(sn([{name:"a_fade_opacity",components:1,type:"Uint32"}],4),sn([{name:"a_placed",components:2,type:"Uint8"}],4)),Do=(sn([{type:"Int16",name:"anchorPointX"},{type:"Int16",name:"anchorPointY"},{type:"Int16",name:"x1"},{type:"Int16",name:"y1"},{type:"Int16",name:"x2"},{type:"Int16",name:"y2"},{type:"Uint32",name:"featureIndex"},{type:"Uint16",name:"sourceLayerIndex"},{type:"Uint16",name:"bucketIndex"},{type:"Int16",name:"radius"},{type:"Int16",name:"signedDistanceFromAnchor"}]),sn([{name:"a_pos",components:2,type:"Int16"},{name:"a_anchor_pos",components:2,type:"Int16"},{name:"a_extrude",components:2,type:"Int16"}],4)),jo=sn([{name:"a_pos",components:2,type:"Int16"},{name:"a_anchor_pos",components:2,type:"Int16"},{name:"a_extrude",components:2,type:"Int16"}],4);sn([{type:"Int16",name:"anchorX"},{type:"Int16",name:"anchorY"},{type:"Uint16",name:"glyphStartIndex"},{type:"Uint16",name:"numGlyphs"},{type:"Uint32",name:"vertexStartIndex"},{type:"Uint32",name:"lineStartIndex"},{type:"Uint32",name:"lineLength"},{type:"Uint16",name:"segment"},{type:"Uint16",name:"lowerSize"},{type:"Uint16",name:"upperSize"},{type:"Float32",name:"lineOffsetX"},{type:"Float32",name:"lineOffsetY"},{type:"Uint8",name:"writingMode"},{type:"Uint8",name:"hidden"}]),sn([{type:"Int16",name:"anchorX"},{type:"Int16",name:"anchorY"},{type:"Int16",name:"horizontalPlacedTextSymbolIndex"},{type:"Int16",name:"verticalPlacedTextSymbolIndex"},{type:"Uint16",name:"key"},{type:"Uint16",name:"textBoxStartIndex"},{type:"Uint16",name:"textBoxEndIndex"},{type:"Uint16",name:"iconBoxStartIndex"},{type:"Uint16",name:"iconBoxEndIndex"},{type:"Uint16",name:"featureIndex"},{type:"Uint16",name:"numGlyphVertices"},{type:"Uint16",name:"numVerticalGlyphVertices"},{type:"Uint16",name:"numIconVertices"},{type:"Uint32",name:"crossTileID"}]),sn([{type:"Float32",name:"offsetX"}]),sn([{type:"Int16",name:"x"},{type:"Int16",name:"y"},{type:"Int16",name:"tileUnitDistanceFromAnchor"}]);function Uo(t,e,r){var n=e.layout.get("text-transform").evaluate(r,{});return "uppercase"===n?t=t.toLocaleUpperCase():"lowercase"===n&&(t=t.toLocaleLowerCase()),Ur.applyArabicShaping&&(t=Ur.applyArabicShaping(t)),t}function qo(t,e,r){return t instanceof ct?(t.sections.forEach(function(t){t.text=Uo(t.text,e,r);}),t):Uo(t,e,r)}var Ro={"!":"︕","#":"＃",$:"＄","%":"％","&":"＆","(":"︵",")":"︶","*":"＊","+":"＋",",":"︐","-":"︲",".":"・","/":"／",":":"︓",";":"︔","<":"︿","=":"＝",">":"﹀","?":"︖","@":"＠","[":"﹇","\\":"＼","]":"﹈","^":"＾",_:"︳","`":"｀","{":"︷","|":"―","}":"︸","~":"～","¢":"￠","£":"￡","¥":"￥","¦":"￤","¬":"￢","¯":"￣","–":"︲","—":"︱","‘":"﹃","’":"﹄","“":"﹁","”":"﹂","…":"︙","‧":"・","₩":"￦","、":"︑","。":"︒","〈":"︿","〉":"﹀","《":"︽","》":"︾","「":"﹁","」":"﹂","『":"﹃","』":"﹄","【":"︻","】":"︼","〔":"︹","〕":"︺","〖":"︗","〗":"︘","！":"︕","（":"︵","）":"︶","，":"︐","－":"︲","．":"・","：":"︓","；":"︔","＜":"︿","＞":"﹀","？":"︖","［":"﹇","］":"﹈","＿":"︳","｛":"︷","｜":"―","｝":"︸","｟":"︵","｠":"︶","｡":"︒","｢":"﹁","｣":"﹂"};var No=function(t){function e(e,r,n,i){t.call(this,e,r),this.angle=n,void 0!==i&&(this.segment=i);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.clone=function(){return new e(this.x,this.y,this.angle,this.segment)},e}(a);kr("Anchor",No);var Zo=256;function Xo(t,e){var r=e.expression;if("constant"===r.kind)return {functionType:"constant",layoutSize:r.evaluate(new qr(t+1))};if("source"===r.kind)return {functionType:"source"};for(var n=r.zoomStops,i=0;i<n.length&&n[i]<=t;)i++;for(var a=i=Math.max(0,i-1);a<n.length&&n[a]<t+1;)a++;a=Math.min(n.length-1,a);var o={min:n[i],max:n[a]};return "composite"===r.kind?{functionType:"composite",zoomRange:o,propertyValue:e.value}:{functionType:"camera",layoutSize:r.evaluate(new qr(t+1)),zoomRange:o,sizeRange:{min:r.evaluate(new qr(o.min)),max:r.evaluate(new qr(o.max))},propertyValue:e.value}}var Ho=_o.VectorTileFeature.types,Go=[{name:"a_fade_opacity",components:1,type:"Uint8",offset:0}];function Jo(t,e,r,n,i,a,o,s){t.emplaceBack(e,r,Math.round(32*n),Math.round(32*i),a,o,s?s[0]:0,s?s[1]:0);}function Ko(t,e,r){t.emplaceBack(e.x,e.y,r),t.emplaceBack(e.x,e.y,r),t.emplaceBack(e.x,e.y,r),t.emplaceBack(e.x,e.y,r);}var Yo=function(t){this.layoutVertexArray=new yn,this.indexArray=new zn,this.programConfigurations=t,this.segments=new Zn,this.dynamicLayoutVertexArray=new dn,this.opacityVertexArray=new mn,this.placedSymbolArray=new Tn;};Yo.prototype.upload=function(t,e,r,n){r&&(this.layoutVertexBuffer=t.createVertexBuffer(this.layoutVertexArray,Fo.members),this.indexBuffer=t.createIndexBuffer(this.indexArray,e),this.dynamicLayoutVertexBuffer=t.createVertexBuffer(this.dynamicLayoutVertexArray,Oo.members,!0),this.opacityVertexBuffer=t.createVertexBuffer(this.opacityVertexArray,Go,!0),this.opacityVertexBuffer.itemSize=1),(r||n)&&this.programConfigurations.upload(t);},Yo.prototype.destroy=function(){this.layoutVertexBuffer&&(this.layoutVertexBuffer.destroy(),this.indexBuffer.destroy(),this.programConfigurations.destroy(),this.segments.destroy(),this.dynamicLayoutVertexBuffer.destroy(),this.opacityVertexBuffer.destroy());},kr("SymbolBuffers",Yo);var $o=function(t,e,r){this.layoutVertexArray=new t,this.layoutAttributes=e,this.indexArray=new r,this.segments=new Zn,this.collisionVertexArray=new xn;};$o.prototype.upload=function(t){this.layoutVertexBuffer=t.createVertexBuffer(this.layoutVertexArray,this.layoutAttributes),this.indexBuffer=t.createIndexBuffer(this.indexArray),this.collisionVertexBuffer=t.createVertexBuffer(this.collisionVertexArray,Lo.members,!0);},$o.prototype.destroy=function(){this.layoutVertexBuffer&&(this.layoutVertexBuffer.destroy(),this.indexBuffer.destroy(),this.segments.destroy(),this.collisionVertexBuffer.destroy());},kr("CollisionBuffers",$o);var Wo=function(t){this.collisionBoxArray=t.collisionBoxArray,this.zoom=t.zoom,this.overscaling=t.overscaling,this.layers=t.layers,this.layerIds=this.layers.map(function(t){return t.id}),this.index=t.index,this.pixelRatio=t.pixelRatio,this.sourceLayerIndex=t.sourceLayerIndex,this.hasPattern=!1;var e=this.layers[0]._unevaluatedLayout._values;this.textSizeData=Xo(this.zoom,e["text-size"]),this.iconSizeData=Xo(this.zoom,e["icon-size"]);var r=this.layers[0].layout,n="viewport-y"===r.get("symbol-z-order");this.sortFeaturesByY=n&&(r.get("text-allow-overlap")||r.get("icon-allow-overlap")||r.get("text-ignore-placement")||r.get("icon-ignore-placement")),this.sourceID=t.sourceID;};Wo.prototype.createArrays=function(){this.text=new Yo(new li(Fo.members,this.layers,this.zoom,function(t){return /^text/.test(t)})),this.icon=new Yo(new li(Fo.members,this.layers,this.zoom,function(t){return /^icon/.test(t)})),this.collisionBox=new $o(gn,Do.members,Sn),this.collisionCircle=new $o(gn,jo.members,zn),this.glyphOffsetArray=new Ln,this.lineVertexArray=new jn,this.symbolInstances=new Fn;},Wo.prototype.calculateGlyphDependencies=function(t,e,r,n){for(var i=0;i<t.length;i++)if(e[t.charCodeAt(i)]=!0,r&&n){var a=Ro[t.charAt(i)];a&&(e[a.charCodeAt(0)]=!0);}},Wo.prototype.populate=function(t,e){var r=this.layers[0],n=r.layout,i=n.get("text-font"),a=n.get("text-field"),o=n.get("icon-image"),s=("constant"!==a.value.kind||a.value.value.toString().length>0)&&("constant"!==i.value.kind||i.value.value.length>0),u="constant"!==o.value.kind||o.value.value&&o.value.value.length>0;if(this.features=[],s||u){for(var p=e.iconDependencies,l=e.glyphDependencies,c=new qr(this.zoom),h=0,f=t;h<f.length;h+=1){var y=f[h],d=y.feature,m=y.index,v=y.sourceLayerIndex;if(r._featureFilter(c,d)){var g=void 0;s&&(g=qo(g=r.getValueAndResolveTokens("text-field",d),r,d));var x=void 0;if(u&&(x=r.getValueAndResolveTokens("icon-image",d)),g||x){var b={text:g,icon:x,index:m,sourceLayerIndex:v,geometry:mi(d),properties:d.properties,type:Ho[d.type]};if(void 0!==d.id&&(b.id=d.id),this.features.push(b),x&&(p[x]=!0),g){var _=i.evaluate(d,{}).join(","),w=l[_]=l[_]||{},A="map"===n.get("text-rotation-alignment")&&"point"!==n.get("symbol-placement");if(g instanceof ct)for(var k=0,z=g.sections;k<z.length;k+=1){var S=z[k],B=Pr(g.toString()),I=S.fontStack||_,V=l[I]=l[I]||{};this.calculateGlyphDependencies(S.text,V,A,B);}else{var P=Pr(g);this.calculateGlyphDependencies(g,w,A,P);}}}}}"line"===n.get("symbol-placement")&&(this.features=function(t){var e={},r={},n=[],i=0;function a(e){n.push(t[e]),i++;}function o(t,e,i){var a=r[t];return delete r[t],r[e]=a,n[a].geometry[0].pop(),n[a].geometry[0]=n[a].geometry[0].concat(i[0]),a}function s(t,r,i){var a=e[r];return delete e[r],e[t]=a,n[a].geometry[0].shift(),n[a].geometry[0]=i[0].concat(n[a].geometry[0]),a}function u(t,e,r){var n=r?e[0][e[0].length-1]:e[0][0];return t+":"+n.x+":"+n.y}for(var p=0;p<t.length;p++){var l=t[p],c=l.geometry,h=l.text instanceof ct?l.text.toString():l.text;if(h){var f=u(h,c),y=u(h,c,!0);if(f in r&&y in e&&r[f]!==e[y]){var d=s(f,y,c),m=o(f,y,n[d].geometry);delete e[f],delete r[y],r[u(h,n[m].geometry,!0)]=m,n[d].geometry=null;}else f in r?o(f,y,c):y in e?s(f,y,c):(a(p),e[f]=i-1,r[y]=i-1);}else a(p);}return n.filter(function(t){return t.geometry})}(this.features));}},Wo.prototype.update=function(t,e,r){this.stateDependentLayers.length&&(this.text.programConfigurations.updatePaintArrays(t,e,this.layers,r),this.icon.programConfigurations.updatePaintArrays(t,e,this.layers,r));},Wo.prototype.isEmpty=function(){return 0===this.symbolInstances.length},Wo.prototype.uploadPending=function(){return !this.uploaded||this.text.programConfigurations.needsUpload||this.icon.programConfigurations.needsUpload},Wo.prototype.upload=function(t){this.uploaded||(this.collisionBox.upload(t),this.collisionCircle.upload(t)),this.text.upload(t,this.sortFeaturesByY,!this.uploaded,this.text.programConfigurations.needsUpload),this.icon.upload(t,this.sortFeaturesByY,!this.uploaded,this.icon.programConfigurations.needsUpload),this.uploaded=!0;},Wo.prototype.destroy=function(){this.text.destroy(),this.icon.destroy(),this.collisionBox.destroy(),this.collisionCircle.destroy();},Wo.prototype.addToLineVertexArray=function(t,e){var r=this.lineVertexArray.length;if(void 0!==t.segment){for(var n=t.dist(e[t.segment+1]),i=t.dist(e[t.segment]),a={},o=t.segment+1;o<e.length;o++)a[o]={x:e[o].x,y:e[o].y,tileUnitDistanceFromAnchor:n},o<e.length-1&&(n+=e[o+1].dist(e[o]));for(var s=t.segment||0;s>=0;s--)a[s]={x:e[s].x,y:e[s].y,tileUnitDistanceFromAnchor:i},s>0&&(i+=e[s-1].dist(e[s]));for(var u=0;u<e.length;u++){var p=a[u];this.lineVertexArray.emplaceBack(p.x,p.y,p.tileUnitDistanceFromAnchor);}}return {lineStartIndex:r,lineLength:this.lineVertexArray.length-r}},Wo.prototype.addSymbols=function(t,e,r,n,i,a,o,s,u,p){for(var l=t.indexArray,c=t.layoutVertexArray,h=t.dynamicLayoutVertexArray,f=t.segments.prepareSegment(4*e.length,t.layoutVertexArray,t.indexArray),y=this.glyphOffsetArray.length,d=f.vertexLength,m=0,v=e;m<v.length;m+=1){var g=v[m],x=g.tl,b=g.tr,_=g.bl,w=g.br,A=g.tex,k=f.vertexLength,z=g.glyphOffset[1];Jo(c,s.x,s.y,x.x,z+x.y,A.x,A.y,r),Jo(c,s.x,s.y,b.x,z+b.y,A.x+A.w,A.y,r),Jo(c,s.x,s.y,_.x,z+_.y,A.x,A.y+A.h,r),Jo(c,s.x,s.y,w.x,z+w.y,A.x+A.w,A.y+A.h,r),Ko(h,s,0),l.emplaceBack(k,k+1,k+2),l.emplaceBack(k+1,k+2,k+3),f.vertexLength+=4,f.primitiveLength+=2,this.glyphOffsetArray.emplaceBack(g.glyphOffset[0]);}t.placedSymbolArray.emplaceBack(s.x,s.y,y,this.glyphOffsetArray.length-y,d,u,p,s.segment,r?r[0]:0,r?r[1]:0,n[0],n[1],o,!1),t.programConfigurations.populatePaintArrays(t.layoutVertexArray.length,a,a.index,{});},Wo.prototype._addCollisionDebugVertex=function(t,e,r,n,i,a){return e.emplaceBack(0,0),t.emplaceBack(r.x,r.y,n,i,Math.round(a.x),Math.round(a.y))},Wo.prototype.addCollisionDebugVertices=function(t,e,r,n,i,o,s,u){var p=i.segments.prepareSegment(4,i.layoutVertexArray,i.indexArray),l=p.vertexLength,c=i.layoutVertexArray,h=i.collisionVertexArray,f=s.anchorX,y=s.anchorY;if(this._addCollisionDebugVertex(c,h,o,f,y,new a(t,e)),this._addCollisionDebugVertex(c,h,o,f,y,new a(r,e)),this._addCollisionDebugVertex(c,h,o,f,y,new a(r,n)),this._addCollisionDebugVertex(c,h,o,f,y,new a(t,n)),p.vertexLength+=4,u){var d=i.indexArray;d.emplaceBack(l,l+1,l+2),d.emplaceBack(l,l+2,l+3),p.primitiveLength+=2;}else{var m=i.indexArray;m.emplaceBack(l,l+1),m.emplaceBack(l+1,l+2),m.emplaceBack(l+2,l+3),m.emplaceBack(l+3,l),p.primitiveLength+=4;}},Wo.prototype.addDebugCollisionBoxes=function(t,e,r){for(var n=t;n<e;n++){var i=this.collisionBoxArray.get(n),a=i.x1,o=i.y1,s=i.x2,u=i.y2,p=i.radius>0;this.addCollisionDebugVertices(a,o,s,u,p?this.collisionCircle:this.collisionBox,i.anchorPoint,r,p);}},Wo.prototype.generateCollisionDebugBuffers=function(){for(var t=0;t<this.symbolInstances.length;t++){var e=this.symbolInstances.get(t);this.addDebugCollisionBoxes(e.textBoxStartIndex,e.textBoxEndIndex,e),this.addDebugCollisionBoxes(e.iconBoxStartIndex,e.iconBoxEndIndex,e);}},Wo.prototype._deserializeCollisionBoxesForSymbol=function(t,e,r,n,i){for(var a={},o=e;o<r;o++){var s=t.get(o);if(0===s.radius){a.textBox={x1:s.x1,y1:s.y1,x2:s.x2,y2:s.y2,anchorPointX:s.anchorPointX,anchorPointY:s.anchorPointY},a.textFeatureIndex=s.featureIndex;break}a.textCircles||(a.textCircles=[],a.textFeatureIndex=s.featureIndex);a.textCircles.push(s.anchorPointX,s.anchorPointY,s.radius,s.signedDistanceFromAnchor,1);}for(var u=n;u<i;u++){var p=t.get(u);if(0===p.radius){a.iconBox={x1:p.x1,y1:p.y1,x2:p.x2,y2:p.y2,anchorPointX:p.anchorPointX,anchorPointY:p.anchorPointY},a.iconFeatureIndex=p.featureIndex;break}}return a},Wo.prototype.deserializeCollisionBoxes=function(t){this.collisionArrays=[];for(var e=0;e<this.symbolInstances.length;e++){var r=this.symbolInstances.get(e);this.collisionArrays.push(this._deserializeCollisionBoxesForSymbol(t,r.textBoxStartIndex,r.textBoxEndIndex,r.iconBoxStartIndex,r.iconBoxEndIndex));}},Wo.prototype.hasTextData=function(){return this.text.segments.get().length>0},Wo.prototype.hasIconData=function(){return this.icon.segments.get().length>0},Wo.prototype.hasCollisionBoxData=function(){return this.collisionBox.segments.get().length>0},Wo.prototype.hasCollisionCircleData=function(){return this.collisionCircle.segments.get().length>0},Wo.prototype.addIndicesForPlacedTextSymbol=function(t){for(var e=this.text.placedSymbolArray.get(t),r=e.vertexStartIndex+4*e.numGlyphs,n=e.vertexStartIndex;n<r;n+=4)this.text.indexArray.emplaceBack(n,n+1,n+2),this.text.indexArray.emplaceBack(n+1,n+2,n+3);},Wo.prototype.sortFeatures=function(t){if(this.sortFeaturesByY&&this.sortedAngle!==t&&(this.sortedAngle=t,!(this.text.segments.get().length>1||this.icon.segments.get().length>1))){for(var e=[],r=0;r<this.symbolInstances.length;r++)e.push(r);for(var n=Math.sin(t),i=Math.cos(t),a=[],o=[],s=0;s<this.symbolInstances.length;s++){var u=this.symbolInstances.get(s);a.push(0|Math.round(n*u.anchorX+i*u.anchorY)),o.push(u.featureIndex);}e.sort(function(t,e){return a[t]-a[e]||o[e]-o[t]}),this.text.indexArray.clear(),this.icon.indexArray.clear(),this.featureSortOrder=[];for(var p=0,l=e;p<l.length;p+=1){var c=l[p],h=this.symbolInstances.get(c);this.featureSortOrder.push(h.featureIndex),h.horizontalPlacedTextSymbolIndex>=0&&this.addIndicesForPlacedTextSymbol(h.horizontalPlacedTextSymbolIndex),h.verticalPlacedTextSymbolIndex>=0&&this.addIndicesForPlacedTextSymbol(h.verticalPlacedTextSymbolIndex);var f=this.icon.placedSymbolArray.get(c);if(f.numGlyphs){var y=f.vertexStartIndex;this.icon.indexArray.emplaceBack(y,y+1,y+2),this.icon.indexArray.emplaceBack(y+1,y+2,y+3);}}this.text.indexBuffer&&this.text.indexBuffer.updateData(this.text.indexArray),this.icon.indexBuffer&&this.icon.indexBuffer.updateData(this.icon.indexArray);}},kr("SymbolBucket",Wo,{omit:["layers","collisionBoxArray","features","compareText"]}),Wo.MAX_GLYPHS=65535,Wo.addDynamicAttributes=Ko;var Qo=new en({"symbol-placement":new Yr(L.layout_symbol["symbol-placement"]),"symbol-spacing":new Yr(L.layout_symbol["symbol-spacing"]),"symbol-avoid-edges":new Yr(L.layout_symbol["symbol-avoid-edges"]),"symbol-z-order":new Yr(L.layout_symbol["symbol-z-order"]),"icon-allow-overlap":new Yr(L.layout_symbol["icon-allow-overlap"]),"icon-ignore-placement":new Yr(L.layout_symbol["icon-ignore-placement"]),"icon-optional":new Yr(L.layout_symbol["icon-optional"]),"icon-rotation-alignment":new Yr(L.layout_symbol["icon-rotation-alignment"]),"icon-size":new $r(L.layout_symbol["icon-size"]),"icon-text-fit":new Yr(L.layout_symbol["icon-text-fit"]),"icon-text-fit-padding":new Yr(L.layout_symbol["icon-text-fit-padding"]),"icon-image":new $r(L.layout_symbol["icon-image"]),"icon-rotate":new $r(L.layout_symbol["icon-rotate"]),"icon-padding":new Yr(L.layout_symbol["icon-padding"]),"icon-keep-upright":new Yr(L.layout_symbol["icon-keep-upright"]),"icon-offset":new $r(L.layout_symbol["icon-offset"]),"icon-anchor":new $r(L.layout_symbol["icon-anchor"]),"icon-pitch-alignment":new Yr(L.layout_symbol["icon-pitch-alignment"]),"text-pitch-alignment":new Yr(L.layout_symbol["text-pitch-alignment"]),"text-rotation-alignment":new Yr(L.layout_symbol["text-rotation-alignment"]),"text-field":new $r(L.layout_symbol["text-field"]),"text-font":new $r(L.layout_symbol["text-font"]),"text-size":new $r(L.layout_symbol["text-size"]),"text-max-width":new $r(L.layout_symbol["text-max-width"]),"text-line-height":new Yr(L.layout_symbol["text-line-height"]),"text-letter-spacing":new $r(L.layout_symbol["text-letter-spacing"]),"text-justify":new $r(L.layout_symbol["text-justify"]),"text-anchor":new $r(L.layout_symbol["text-anchor"]),"text-max-angle":new Yr(L.layout_symbol["text-max-angle"]),"text-rotate":new $r(L.layout_symbol["text-rotate"]),"text-padding":new Yr(L.layout_symbol["text-padding"]),"text-keep-upright":new Yr(L.layout_symbol["text-keep-upright"]),"text-transform":new $r(L.layout_symbol["text-transform"]),"text-offset":new $r(L.layout_symbol["text-offset"]),"text-allow-overlap":new Yr(L.layout_symbol["text-allow-overlap"]),"text-ignore-placement":new Yr(L.layout_symbol["text-ignore-placement"]),"text-optional":new Yr(L.layout_symbol["text-optional"])}),ts={paint:new en({"icon-opacity":new $r(L.paint_symbol["icon-opacity"]),"icon-color":new $r(L.paint_symbol["icon-color"]),"icon-halo-color":new $r(L.paint_symbol["icon-halo-color"]),"icon-halo-width":new $r(L.paint_symbol["icon-halo-width"]),"icon-halo-blur":new $r(L.paint_symbol["icon-halo-blur"]),"icon-translate":new Yr(L.paint_symbol["icon-translate"]),"icon-translate-anchor":new Yr(L.paint_symbol["icon-translate-anchor"]),"text-opacity":new $r(L.paint_symbol["text-opacity"]),"text-color":new $r(L.paint_symbol["text-color"]),"text-halo-color":new $r(L.paint_symbol["text-halo-color"]),"text-halo-width":new $r(L.paint_symbol["text-halo-width"]),"text-halo-blur":new $r(L.paint_symbol["text-halo-blur"]),"text-translate":new Yr(L.paint_symbol["text-translate"]),"text-translate-anchor":new Yr(L.paint_symbol["text-translate-anchor"])}),layout:Qo},es=function(t){function e(e){t.call(this,e,ts);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.recalculate=function(e){t.prototype.recalculate.call(this,e),"auto"===this.layout.get("icon-rotation-alignment")&&("point"!==this.layout.get("symbol-placement")?this.layout._values["icon-rotation-alignment"]="map":this.layout._values["icon-rotation-alignment"]="viewport"),"auto"===this.layout.get("text-rotation-alignment")&&("point"!==this.layout.get("symbol-placement")?this.layout._values["text-rotation-alignment"]="map":this.layout._values["text-rotation-alignment"]="viewport"),"auto"===this.layout.get("text-pitch-alignment")&&(this.layout._values["text-pitch-alignment"]=this.layout.get("text-rotation-alignment")),"auto"===this.layout.get("icon-pitch-alignment")&&(this.layout._values["icon-pitch-alignment"]=this.layout.get("icon-rotation-alignment"));},e.prototype.getValueAndResolveTokens=function(t,e){var r,n=this.layout.get(t).evaluate(e,{}),i=this._unevaluatedLayout._values[t];return i.isDataDriven()||Ce(i.value)?n:(r=e.properties,n.replace(/{([^{}]+)}/g,function(t,e){return e in r?String(r[e]):""}))},e.prototype.createBucket=function(t){return new Wo(t)},e.prototype.queryRadius=function(){return 0},e.prototype.queryIntersectsFeature=function(){return !1},e}(rn),rs={paint:new en({"background-color":new Yr(L.paint_background["background-color"]),"background-pattern":new Qr(L.paint_background["background-pattern"]),"background-opacity":new Yr(L.paint_background["background-opacity"])})},ns=function(t){function e(e){t.call(this,e,rs);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e}(rn),is={paint:new en({"raster-opacity":new Yr(L.paint_raster["raster-opacity"]),"raster-hue-rotate":new Yr(L.paint_raster["raster-hue-rotate"]),"raster-brightness-min":new Yr(L.paint_raster["raster-brightness-min"]),"raster-brightness-max":new Yr(L.paint_raster["raster-brightness-max"]),"raster-saturation":new Yr(L.paint_raster["raster-saturation"]),"raster-contrast":new Yr(L.paint_raster["raster-contrast"]),"raster-resampling":new Yr(L.paint_raster["raster-resampling"]),"raster-fade-duration":new Yr(L.paint_raster["raster-fade-duration"])})},as={circle:na,heatmap:fa,hillshade:da,fill:to,"fill-extrusion":po,line:To,symbol:es,background:ns,raster:function(t){function e(e){t.call(this,e,is);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e}(rn)};function os(t){for(var e=0,r=0,n=0,i=t;n<i.length;n+=1){var a=i[n];e+=a.w*a.h,r=Math.max(r,a.w);}t.sort(function(t,e){return e.h-t.h});for(var o=[{x:0,y:0,w:Math.max(Math.ceil(Math.sqrt(e/.95)),r),h:1/0}],s=0,u=0,p=0,l=t;p<l.length;p+=1)for(var c=l[p],h=o.length-1;h>=0;h--){var f=o[h];if(!(c.w>f.w||c.h>f.h)){if(c.x=f.x,c.y=f.y,u=Math.max(u,c.y+c.h),s=Math.max(s,c.x+c.w),c.w===f.w&&c.h===f.h){var y=o.pop();h<o.length&&(o[h]=y);}else c.h===f.h?(f.x+=c.w,f.w-=c.w):c.w===f.w?(f.y+=c.h,f.h-=c.h):(o.push({x:f.x+c.w,y:f.y,w:f.w-c.w,h:c.h}),f.y+=c.h,f.h-=c.h);break}}return {w:s,h:u,fill:e/(s*u)||0}}var ss=function(t,e){var r=e.pixelRatio;this.paddedRect=t,this.pixelRatio=r;},us={tl:{configurable:!0},br:{configurable:!0},tlbr:{configurable:!0},displaySize:{configurable:!0}};us.tl.get=function(){return [this.paddedRect.x+1,this.paddedRect.y+1]},us.br.get=function(){return [this.paddedRect.x+this.paddedRect.w-1,this.paddedRect.y+this.paddedRect.h-1]},us.tlbr.get=function(){return this.tl.concat(this.br)},us.displaySize.get=function(){return [(this.paddedRect.w-2)/this.pixelRatio,(this.paddedRect.h-2)/this.pixelRatio]},Object.defineProperties(ss.prototype,us);var ps=function(t,e){var r={},n={},i=[];for(var a in t){var o=t[a],s={x:0,y:0,w:o.data.width+2,h:o.data.height+2};i.push(s),r[a]=new ss(s,o);}for(var u in e){var p=e[u],l={x:0,y:0,w:p.data.width+2,h:p.data.height+2};i.push(l),n[u]=new ss(l,p);}var c=os(i),h=c.w,f=c.h,y=new la({width:h||1,height:f||1});for(var d in t){var m=t[d],v=r[d].paddedRect;la.copy(m.data,y,{x:0,y:0},{x:v.x+1,y:v.y+1},m.data);}for(var g in e){var x=e[g],b=n[g].paddedRect,_=b.x+1,w=b.y+1,A=x.data.width,k=x.data.height;la.copy(x.data,y,{x:0,y:0},{x:_,y:w},x.data),la.copy(x.data,y,{x:0,y:k-1},{x:_,y:w-1},{width:A,height:1}),la.copy(x.data,y,{x:0,y:0},{x:_,y:w+k},{width:A,height:1}),la.copy(x.data,y,{x:A-1,y:0},{x:_-1,y:w},{width:1,height:k}),la.copy(x.data,y,{x:0,y:0},{x:_+A,y:w},{width:1,height:k});}this.image=y,this.iconPositions=r,this.patternPositions=n;};kr("ImagePosition",ss),kr("ImageAtlas",ps);var ls=self.HTMLImageElement,cs=self.HTMLCanvasElement,hs=self.HTMLVideoElement,fs=self.ImageData,ys=function(t,e,r,n){this.context=t,this.format=r,this.texture=t.gl.createTexture(),this.update(e,n);};ys.prototype.update=function(t,e){var r=t.width,n=t.height,i=!this.size||this.size[0]!==r||this.size[1]!==n,a=this.context,o=a.gl;this.useMipmap=Boolean(e&&e.useMipmap),o.bindTexture(o.TEXTURE_2D,this.texture),i?(this.size=[r,n],a.pixelStoreUnpack.set(1),this.format!==o.RGBA||e&&!1===e.premultiply||a.pixelStoreUnpackPremultiplyAlpha.set(!0),t instanceof ls||t instanceof cs||t instanceof hs||t instanceof fs?o.texImage2D(o.TEXTURE_2D,0,this.format,this.format,o.UNSIGNED_BYTE,t):o.texImage2D(o.TEXTURE_2D,0,this.format,r,n,0,this.format,o.UNSIGNED_BYTE,t.data)):t instanceof ls||t instanceof cs||t instanceof hs||t instanceof fs?o.texSubImage2D(o.TEXTURE_2D,0,0,0,o.RGBA,o.UNSIGNED_BYTE,t):o.texSubImage2D(o.TEXTURE_2D,0,0,0,r,n,o.RGBA,o.UNSIGNED_BYTE,t.data),this.useMipmap&&this.isSizePowerOfTwo()&&o.generateMipmap(o.TEXTURE_2D);},ys.prototype.bind=function(t,e,r){var n=this.context.gl;n.bindTexture(n.TEXTURE_2D,this.texture),r!==n.LINEAR_MIPMAP_NEAREST||this.isSizePowerOfTwo()||(r=n.LINEAR),t!==this.filter&&(n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,t),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,r||t),this.filter=t),e!==this.wrap&&(n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,e),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,e),this.wrap=e);},ys.prototype.isSizePowerOfTwo=function(){return this.size[0]===this.size[1]&&Math.log(this.size[0])/Math.LN2%1==0},ys.prototype.destroy=function(){this.context.gl.deleteTexture(this.texture),this.texture=null;};var ds=function(t,e,r,n,i){var a,o,s=8*i-n-1,u=(1<<s)-1,p=u>>1,l=-7,c=r?i-1:0,h=r?-1:1,f=t[e+c];for(c+=h,a=f&(1<<-l)-1,f>>=-l,l+=s;l>0;a=256*a+t[e+c],c+=h,l-=8);for(o=a&(1<<-l)-1,a>>=-l,l+=n;l>0;o=256*o+t[e+c],c+=h,l-=8);if(0===a)a=1-p;else{if(a===u)return o?NaN:1/0*(f?-1:1);o+=Math.pow(2,n),a-=p;}return (f?-1:1)*o*Math.pow(2,a-n)},ms=function(t,e,r,n,i,a){var o,s,u,p=8*a-i-1,l=(1<<p)-1,c=l>>1,h=23===i?Math.pow(2,-24)-Math.pow(2,-77):0,f=n?0:a-1,y=n?1:-1,d=e<0||0===e&&1/e<0?1:0;for(e=Math.abs(e),isNaN(e)||e===1/0?(s=isNaN(e)?1:0,o=l):(o=Math.floor(Math.log(e)/Math.LN2),e*(u=Math.pow(2,-o))<1&&(o--,u*=2),(e+=o+c>=1?h/u:h*Math.pow(2,1-c))*u>=2&&(o++,u/=2),o+c>=l?(s=0,o=l):o+c>=1?(s=(e*u-1)*Math.pow(2,i),o+=c):(s=e*Math.pow(2,c-1)*Math.pow(2,i),o=0));i>=8;t[r+f]=255&s,f+=y,s/=256,i-=8);for(o=o<<i|s,p+=i;p>0;t[r+f]=255&o,f+=y,o/=256,p-=8);t[r+f-y]|=128*d;},vs=gs;function gs(t){this.buf=ArrayBuffer.isView&&ArrayBuffer.isView(t)?t:new Uint8Array(t||0),this.pos=0,this.type=0,this.length=this.buf.length;}gs.Varint=0,gs.Fixed64=1,gs.Bytes=2,gs.Fixed32=5;function xs(t){return t.type===gs.Bytes?t.readVarint()+t.pos:t.pos+1}function bs(t,e,r){return r?4294967296*e+(t>>>0):4294967296*(e>>>0)+(t>>>0)}function _s(t,e,r){var n=e<=16383?1:e<=2097151?2:e<=268435455?3:Math.ceil(Math.log(e)/(7*Math.LN2));r.realloc(n);for(var i=r.pos-1;i>=t;i--)r.buf[i+n]=r.buf[i];}function ws(t,e){for(var r=0;r<t.length;r++)e.writeVarint(t[r]);}function As(t,e){for(var r=0;r<t.length;r++)e.writeSVarint(t[r]);}function ks(t,e){for(var r=0;r<t.length;r++)e.writeFloat(t[r]);}function zs(t,e){for(var r=0;r<t.length;r++)e.writeDouble(t[r]);}function Ss(t,e){for(var r=0;r<t.length;r++)e.writeBoolean(t[r]);}function Bs(t,e){for(var r=0;r<t.length;r++)e.writeFixed32(t[r]);}function Is(t,e){for(var r=0;r<t.length;r++)e.writeSFixed32(t[r]);}function Vs(t,e){for(var r=0;r<t.length;r++)e.writeFixed64(t[r]);}function Ps(t,e){for(var r=0;r<t.length;r++)e.writeSFixed64(t[r]);}function Ms(t,e){return (t[e]|t[e+1]<<8|t[e+2]<<16)+16777216*t[e+3]}function Cs(t,e,r){t[r]=e,t[r+1]=e>>>8,t[r+2]=e>>>16,t[r+3]=e>>>24;}function Ts(t,e){return (t[e]|t[e+1]<<8|t[e+2]<<16)+(t[e+3]<<24)}gs.prototype={destroy:function(){this.buf=null;},readFields:function(t,e,r){for(r=r||this.length;this.pos<r;){var n=this.readVarint(),i=n>>3,a=this.pos;this.type=7&n,t(i,e,this),this.pos===a&&this.skip(n);}return e},readMessage:function(t,e){return this.readFields(t,e,this.readVarint()+this.pos)},readFixed32:function(){var t=Ms(this.buf,this.pos);return this.pos+=4,t},readSFixed32:function(){var t=Ts(this.buf,this.pos);return this.pos+=4,t},readFixed64:function(){var t=Ms(this.buf,this.pos)+4294967296*Ms(this.buf,this.pos+4);return this.pos+=8,t},readSFixed64:function(){var t=Ms(this.buf,this.pos)+4294967296*Ts(this.buf,this.pos+4);return this.pos+=8,t},readFloat:function(){var t=ds(this.buf,this.pos,!0,23,4);return this.pos+=4,t},readDouble:function(){var t=ds(this.buf,this.pos,!0,52,8);return this.pos+=8,t},readVarint:function(t){var e,r,n=this.buf;return e=127&(r=n[this.pos++]),r<128?e:(e|=(127&(r=n[this.pos++]))<<7,r<128?e:(e|=(127&(r=n[this.pos++]))<<14,r<128?e:(e|=(127&(r=n[this.pos++]))<<21,r<128?e:function(t,e,r){var n,i,a=r.buf;if(i=a[r.pos++],n=(112&i)>>4,i<128)return bs(t,n,e);if(i=a[r.pos++],n|=(127&i)<<3,i<128)return bs(t,n,e);if(i=a[r.pos++],n|=(127&i)<<10,i<128)return bs(t,n,e);if(i=a[r.pos++],n|=(127&i)<<17,i<128)return bs(t,n,e);if(i=a[r.pos++],n|=(127&i)<<24,i<128)return bs(t,n,e);if(i=a[r.pos++],n|=(1&i)<<31,i<128)return bs(t,n,e);throw new Error("Expected varint not more than 10 bytes")}(e|=(15&(r=n[this.pos]))<<28,t,this))))},readVarint64:function(){return this.readVarint(!0)},readSVarint:function(){var t=this.readVarint();return t%2==1?(t+1)/-2:t/2},readBoolean:function(){return Boolean(this.readVarint())},readString:function(){var t=this.readVarint()+this.pos,e=function(t,e,r){var n="",i=e;for(;i<r;){var a,o,s,u=t[i],p=null,l=u>239?4:u>223?3:u>191?2:1;if(i+l>r)break;1===l?u<128&&(p=u):2===l?128==(192&(a=t[i+1]))&&(p=(31&u)<<6|63&a)<=127&&(p=null):3===l?(a=t[i+1],o=t[i+2],128==(192&a)&&128==(192&o)&&((p=(15&u)<<12|(63&a)<<6|63&o)<=2047||p>=55296&&p<=57343)&&(p=null)):4===l&&(a=t[i+1],o=t[i+2],s=t[i+3],128==(192&a)&&128==(192&o)&&128==(192&s)&&((p=(15&u)<<18|(63&a)<<12|(63&o)<<6|63&s)<=65535||p>=1114112)&&(p=null)),null===p?(p=65533,l=1):p>65535&&(p-=65536,n+=String.fromCharCode(p>>>10&1023|55296),p=56320|1023&p),n+=String.fromCharCode(p),i+=l;}return n}(this.buf,this.pos,t);return this.pos=t,e},readBytes:function(){var t=this.readVarint()+this.pos,e=this.buf.subarray(this.pos,t);return this.pos=t,e},readPackedVarint:function(t,e){var r=xs(this);for(t=t||[];this.pos<r;)t.push(this.readVarint(e));return t},readPackedSVarint:function(t){var e=xs(this);for(t=t||[];this.pos<e;)t.push(this.readSVarint());return t},readPackedBoolean:function(t){var e=xs(this);for(t=t||[];this.pos<e;)t.push(this.readBoolean());return t},readPackedFloat:function(t){var e=xs(this);for(t=t||[];this.pos<e;)t.push(this.readFloat());return t},readPackedDouble:function(t){var e=xs(this);for(t=t||[];this.pos<e;)t.push(this.readDouble());return t},readPackedFixed32:function(t){var e=xs(this);for(t=t||[];this.pos<e;)t.push(this.readFixed32());return t},readPackedSFixed32:function(t){var e=xs(this);for(t=t||[];this.pos<e;)t.push(this.readSFixed32());return t},readPackedFixed64:function(t){var e=xs(this);for(t=t||[];this.pos<e;)t.push(this.readFixed64());return t},readPackedSFixed64:function(t){var e=xs(this);for(t=t||[];this.pos<e;)t.push(this.readSFixed64());return t},skip:function(t){var e=7&t;if(e===gs.Varint)for(;this.buf[this.pos++]>127;);else if(e===gs.Bytes)this.pos=this.readVarint()+this.pos;else if(e===gs.Fixed32)this.pos+=4;else{if(e!==gs.Fixed64)throw new Error("Unimplemented type: "+e);this.pos+=8;}},writeTag:function(t,e){this.writeVarint(t<<3|e);},realloc:function(t){for(var e=this.length||16;e<this.pos+t;)e*=2;if(e!==this.length){var r=new Uint8Array(e);r.set(this.buf),this.buf=r,this.length=e;}},finish:function(){return this.length=this.pos,this.pos=0,this.buf.subarray(0,this.length)},writeFixed32:function(t){this.realloc(4),Cs(this.buf,t,this.pos),this.pos+=4;},writeSFixed32:function(t){this.realloc(4),Cs(this.buf,t,this.pos),this.pos+=4;},writeFixed64:function(t){this.realloc(8),Cs(this.buf,-1&t,this.pos),Cs(this.buf,Math.floor(t*(1/4294967296)),this.pos+4),this.pos+=8;},writeSFixed64:function(t){this.realloc(8),Cs(this.buf,-1&t,this.pos),Cs(this.buf,Math.floor(t*(1/4294967296)),this.pos+4),this.pos+=8;},writeVarint:function(t){(t=+t||0)>268435455||t<0?function(t,e){var r,n;t>=0?(r=t%4294967296|0,n=t/4294967296|0):(n=~(-t/4294967296),4294967295^(r=~(-t%4294967296))?r=r+1|0:(r=0,n=n+1|0));if(t>=0x10000000000000000||t<-0x10000000000000000)throw new Error("Given varint doesn't fit into 10 bytes");e.realloc(10),function(t,e,r){r.buf[r.pos++]=127&t|128,t>>>=7,r.buf[r.pos++]=127&t|128,t>>>=7,r.buf[r.pos++]=127&t|128,t>>>=7,r.buf[r.pos++]=127&t|128,t>>>=7,r.buf[r.pos]=127&t;}(r,0,e),function(t,e){var r=(7&t)<<4;if(e.buf[e.pos++]|=r|((t>>>=3)?128:0),!t)return;if(e.buf[e.pos++]=127&t|((t>>>=7)?128:0),!t)return;if(e.buf[e.pos++]=127&t|((t>>>=7)?128:0),!t)return;if(e.buf[e.pos++]=127&t|((t>>>=7)?128:0),!t)return;if(e.buf[e.pos++]=127&t|((t>>>=7)?128:0),!t)return;e.buf[e.pos++]=127&t;}(n,e);}(t,this):(this.realloc(4),this.buf[this.pos++]=127&t|(t>127?128:0),t<=127||(this.buf[this.pos++]=127&(t>>>=7)|(t>127?128:0),t<=127||(this.buf[this.pos++]=127&(t>>>=7)|(t>127?128:0),t<=127||(this.buf[this.pos++]=t>>>7&127))));},writeSVarint:function(t){this.writeVarint(t<0?2*-t-1:2*t);},writeBoolean:function(t){this.writeVarint(Boolean(t));},writeString:function(t){t=String(t),this.realloc(4*t.length),this.pos++;var e=this.pos;this.pos=function(t,e,r){for(var n,i,a=0;a<e.length;a++){if((n=e.charCodeAt(a))>55295&&n<57344){if(!i){n>56319||a+1===e.length?(t[r++]=239,t[r++]=191,t[r++]=189):i=n;continue}if(n<56320){t[r++]=239,t[r++]=191,t[r++]=189,i=n;continue}n=i-55296<<10|n-56320|65536,i=null;}else i&&(t[r++]=239,t[r++]=191,t[r++]=189,i=null);n<128?t[r++]=n:(n<2048?t[r++]=n>>6|192:(n<65536?t[r++]=n>>12|224:(t[r++]=n>>18|240,t[r++]=n>>12&63|128),t[r++]=n>>6&63|128),t[r++]=63&n|128);}return r}(this.buf,t,this.pos);var r=this.pos-e;r>=128&&_s(e,r,this),this.pos=e-1,this.writeVarint(r),this.pos+=r;},writeFloat:function(t){this.realloc(4),ms(this.buf,t,this.pos,!0,23,4),this.pos+=4;},writeDouble:function(t){this.realloc(8),ms(this.buf,t,this.pos,!0,52,8),this.pos+=8;},writeBytes:function(t){var e=t.length;this.writeVarint(e),this.realloc(e);for(var r=0;r<e;r++)this.buf[this.pos++]=t[r];},writeRawMessage:function(t,e){this.pos++;var r=this.pos;t(e,this);var n=this.pos-r;n>=128&&_s(r,n,this),this.pos=r-1,this.writeVarint(n),this.pos+=n;},writeMessage:function(t,e,r){this.writeTag(t,gs.Bytes),this.writeRawMessage(e,r);},writePackedVarint:function(t,e){this.writeMessage(t,ws,e);},writePackedSVarint:function(t,e){this.writeMessage(t,As,e);},writePackedBoolean:function(t,e){this.writeMessage(t,Ss,e);},writePackedFloat:function(t,e){this.writeMessage(t,ks,e);},writePackedDouble:function(t,e){this.writeMessage(t,zs,e);},writePackedFixed32:function(t,e){this.writeMessage(t,Bs,e);},writePackedSFixed32:function(t,e){this.writeMessage(t,Is,e);},writePackedFixed64:function(t,e){this.writeMessage(t,Vs,e);},writePackedSFixed64:function(t,e){this.writeMessage(t,Ps,e);},writeBytesField:function(t,e){this.writeTag(t,gs.Bytes),this.writeBytes(e);},writeFixed32Field:function(t,e){this.writeTag(t,gs.Fixed32),this.writeFixed32(e);},writeSFixed32Field:function(t,e){this.writeTag(t,gs.Fixed32),this.writeSFixed32(e);},writeFixed64Field:function(t,e){this.writeTag(t,gs.Fixed64),this.writeFixed64(e);},writeSFixed64Field:function(t,e){this.writeTag(t,gs.Fixed64),this.writeSFixed64(e);},writeVarintField:function(t,e){this.writeTag(t,gs.Varint),this.writeVarint(e);},writeSVarintField:function(t,e){this.writeTag(t,gs.Varint),this.writeSVarint(e);},writeStringField:function(t,e){this.writeTag(t,gs.Bytes),this.writeString(e);},writeFloatField:function(t,e){this.writeTag(t,gs.Fixed32),this.writeFloat(e);},writeDoubleField:function(t,e){this.writeTag(t,gs.Fixed64),this.writeDouble(e);},writeBooleanField:function(t,e){this.writeVarintField(t,Boolean(e));}};var Es=3;function Fs(t,e,r){1===t&&r.readMessage(Os,e);}function Os(t,e,r){if(3===t){var n=r.readMessage(Ls,{}),i=n.id,a=n.bitmap,o=n.width,s=n.height,u=n.left,p=n.top,l=n.advance;e.push({id:i,bitmap:new pa({width:o+2*Es,height:s+2*Es},a),metrics:{width:o,height:s,left:u,top:p,advance:l}});}}function Ls(t,e,r){1===t?e.id=r.readVarint():2===t?e.bitmap=r.readBytes():3===t?e.width=r.readVarint():4===t?e.height=r.readVarint():5===t?e.left=r.readSVarint():6===t?e.top=r.readSVarint():7===t&&(e.advance=r.readVarint());}var Ds=Es,js=function(t,e,r){this.target=t,this.parent=e,this.mapId=r,this.callbacks={},this.callbackID=0,y(["receive"],this),this.target.addEventListener("message",this.receive,!1);};function Us(t,e,r){var n=2*Math.PI*6378137/256/Math.pow(2,r);return [t*n-2*Math.PI*6378137/2,e*n-2*Math.PI*6378137/2]}js.prototype.send=function(t,e,r,n){var i=r?this.mapId+":"+this.callbackID++:null;r&&(this.callbacks[i]=r);var a=[];this.target.postMessage({targetMapId:n,sourceMapId:this.mapId,type:t,id:String(i),data:Sr(e,a)},a);},js.prototype.receive=function(t){var e,r=this,n=t.data,i=n.id;if(!n.targetMapId||this.mapId===n.targetMapId){var a=function(t,e){var n=[];r.target.postMessage({sourceMapId:r.mapId,type:"<response>",id:String(i),error:t?Sr(t):null,data:Sr(e,n)},n);};if("<response>"===n.type)e=this.callbacks[n.id],delete this.callbacks[n.id],e&&n.error?e(Br(n.error)):e&&e(null,Br(n.data));else if(void 0!==n.id&&this.parent[n.type])this.parent[n.type](n.sourceMapId,Br(n.data),a);else if(void 0!==n.id&&this.parent.getWorkerSource){var o=n.type.split("."),s=Br(n.data);this.parent.getWorkerSource(n.sourceMapId,o[0],s.source)[o[1]](s,a);}else this.parent[n.type](Br(n.data));}},js.prototype.remove=function(){this.target.removeEventListener("message",this.receive,!1);};var qs=function(t,e,r){this.z=t,this.x=e,this.y=r,this.key=Zs(0,t,e,r);};qs.prototype.equals=function(t){return this.z===t.z&&this.x===t.x&&this.y===t.y},qs.prototype.url=function(t,e){var r,n,i,a,o,s=(r=this.x,n=this.y,i=this.z,a=Us(256*r,256*(n=Math.pow(2,i)-n-1),i),o=Us(256*(r+1),256*(n+1),i),a[0]+","+a[1]+","+o[0]+","+o[1]),u=function(t,e,r){for(var n,i="",a=t;a>0;a--)i+=(e&(n=1<<a-1)?1:0)+(r&n?2:0);return i}(this.z,this.x,this.y);return t[(this.x+this.y)%t.length].replace("{prefix}",(this.x%16).toString(16)+(this.y%16).toString(16)).replace("{z}",String(this.z)).replace("{x}",String(this.x)).replace("{y}",String("tms"===e?Math.pow(2,this.z)-this.y-1:this.y)).replace("{quadkey}",u).replace("{bbox-epsg-3857}",s)};var Rs=function(t,e){this.wrap=t,this.canonical=e,this.key=Zs(t,e.z,e.x,e.y);},Ns=function(t,e,r,n,i){this.overscaledZ=t,this.wrap=e,this.canonical=new qs(r,+n,+i),this.key=Zs(e,t,n,i);};function Zs(t,e,r,n){(t*=2)<0&&(t=-1*t-1);var i=1<<e;return 32*(i*i*t+i*n+r)+e}Ns.prototype.equals=function(t){return this.overscaledZ===t.overscaledZ&&this.wrap===t.wrap&&this.canonical.equals(t.canonical)},Ns.prototype.scaledTo=function(t){var e=this.canonical.z-t;return t>this.canonical.z?new Ns(t,this.wrap,this.canonical.z,this.canonical.x,this.canonical.y):new Ns(t,this.wrap,t,this.canonical.x>>e,this.canonical.y>>e)},Ns.prototype.isChildOf=function(t){var e=this.canonical.z-t.canonical.z;return 0===t.overscaledZ||t.overscaledZ<this.overscaledZ&&t.canonical.x===this.canonical.x>>e&&t.canonical.y===this.canonical.y>>e},Ns.prototype.children=function(t){if(this.overscaledZ>=t)return [new Ns(this.overscaledZ+1,this.wrap,this.canonical.z,this.canonical.x,this.canonical.y)];var e=this.canonical.z+1,r=2*this.canonical.x,n=2*this.canonical.y;return [new Ns(e,this.wrap,e,r,n),new Ns(e,this.wrap,e,r+1,n),new Ns(e,this.wrap,e,r,n+1),new Ns(e,this.wrap,e,r+1,n+1)]},Ns.prototype.isLessThan=function(t){return this.wrap<t.wrap||!(this.wrap>t.wrap)&&(this.overscaledZ<t.overscaledZ||!(this.overscaledZ>t.overscaledZ)&&(this.canonical.x<t.canonical.x||!(this.canonical.x>t.canonical.x)&&this.canonical.y<t.canonical.y))},Ns.prototype.wrapped=function(){return new Ns(this.overscaledZ,0,this.canonical.z,this.canonical.x,this.canonical.y)},Ns.prototype.unwrapTo=function(t){return new Ns(this.overscaledZ,t,this.canonical.z,this.canonical.x,this.canonical.y)},Ns.prototype.overscaleFactor=function(){return Math.pow(2,this.overscaledZ-this.canonical.z)},Ns.prototype.toUnwrapped=function(){return new Rs(this.wrap,this.canonical)},Ns.prototype.toString=function(){return this.overscaledZ+"/"+this.canonical.x+"/"+this.canonical.y},Ns.prototype.toCoordinate=function(){return new i(this.canonical.x+Math.pow(2,this.wrap),this.canonical.y,this.canonical.z)},kr("CanonicalTileID",qs),kr("OverscaledTileID",Ns,{omit:["posMatrix"]});var Xs=function(t,e,r){if(this.uid=t,e.height!==e.width)throw new RangeError("DEM tiles must be square");if(r&&"mapbox"!==r&&"terrarium"!==r)return b('"'+r+'" is not a valid encoding type. Valid types include "mapbox" and "terrarium".');var n=this.dim=e.height;this.border=Math.max(Math.ceil(e.height/2),1),this.stride=this.dim+2*this.border,this.data=new Int32Array(this.stride*this.stride);for(var i=e.data,a="terrarium"===r?this._unpackTerrarium:this._unpackMapbox,o=0;o<n;o++)for(var s=0;s<n;s++){var u=4*(o*n+s);this.set(s,o,a(i[u],i[u+1],i[u+2]));}for(var p=0;p<n;p++)this.set(-1,p,this.get(0,p)),this.set(n,p,this.get(n-1,p)),this.set(p,-1,this.get(p,0)),this.set(p,n,this.get(p,n-1));this.set(-1,-1,this.get(0,0)),this.set(n,-1,this.get(n-1,0)),this.set(-1,n,this.get(0,n-1)),this.set(n,n,this.get(n-1,n-1));};Xs.prototype.set=function(t,e,r){this.data[this._idx(t,e)]=r+65536;},Xs.prototype.get=function(t,e){return this.data[this._idx(t,e)]-65536},Xs.prototype._idx=function(t,e){if(t<-this.border||t>=this.dim+this.border||e<-this.border||e>=this.dim+this.border)throw new RangeError("out of range source coordinates for DEM data");return (e+this.border)*this.stride+(t+this.border)},Xs.prototype._unpackMapbox=function(t,e,r){return (256*t*256+256*e+r)/10-1e4},Xs.prototype._unpackTerrarium=function(t,e,r){return 256*t+e+r/256-32768},Xs.prototype.getPixels=function(){return new la({width:this.dim+2*this.border,height:this.dim+2*this.border},new Uint8Array(this.data.buffer))},Xs.prototype.backfillBorder=function(t,e,r){if(this.dim!==t.dim)throw new Error("dem dimension mismatch");var n=e*this.dim,i=e*this.dim+this.dim,a=r*this.dim,o=r*this.dim+this.dim;switch(e){case-1:n=i-1;break;case 1:i=n+1;}switch(r){case-1:a=o-1;break;case 1:o=a+1;}for(var s=l(n,-this.border,this.dim+this.border),u=l(i,-this.border,this.dim+this.border),p=l(a,-this.border,this.dim+this.border),c=l(o,-this.border,this.dim+this.border),h=-e*this.dim,f=-r*this.dim,y=p;y<c;y++)for(var d=s;d<u;d++)this.set(d,y,t.get(d+h,y+f));},kr("DEMData",Xs);var Hs=sn([{name:"a_pos",type:"Int16",components:2},{name:"a_texture_pos",type:"Int16",components:2}]);var Gs=function(t){this._stringToNumber={},this._numberToString=[];for(var e=0;e<t.length;e++){var r=t[e];this._stringToNumber[r]=e,this._numberToString[e]=r;}};Gs.prototype.encode=function(t){return this._stringToNumber[t]},Gs.prototype.decode=function(t){return this._numberToString[t]};var Js=function(t,e,r,n){this.type="Feature",this._vectorTileFeature=t,t._z=e,t._x=r,t._y=n,this.properties=t.properties,null!=t.id&&(this.id=t.id);},Ks={geometry:{configurable:!0}};Ks.geometry.get=function(){return void 0===this._geometry&&(this._geometry=this._vectorTileFeature.toGeoJSON(this._vectorTileFeature._x,this._vectorTileFeature._y,this._vectorTileFeature._z).geometry),this._geometry},Ks.geometry.set=function(t){this._geometry=t;},Js.prototype.toJSON=function(){var t={geometry:this.geometry};for(var e in this)"_geometry"!==e&&"_vectorTileFeature"!==e&&(t[e]=this[e]);return t},Object.defineProperties(Js.prototype,Ks);var Ys=function(){this.state={},this.stateChanges={};};Ys.prototype.updateState=function(t,e,r){var n=String(e);this.stateChanges[t]=this.stateChanges[t]||{},this.stateChanges[t][n]=this.stateChanges[t][n]||{},c(this.stateChanges[t][n],r);},Ys.prototype.getState=function(t,e){var r=String(e),n=this.state[t]||{},i=this.stateChanges[t]||{};return c({},n[r],i[r])},Ys.prototype.initializeTileState=function(t,e){t.setFeatureState(this.state,e);},Ys.prototype.coalesceChanges=function(t,e){var r={};for(var n in this.stateChanges){this.state[n]=this.state[n]||{};var i={};for(var a in this.stateChanges[n])this.state[n][a]||(this.state[n][a]={}),c(this.state[n][a],this.stateChanges[n][a]),i[a]=this.state[n][a];r[n]=i;}if(this.stateChanges={},0!==Object.keys(r).length)for(var o in t){t[o].setFeatureState(r,e);}};var $s=function(t,e,r){this.tileID=t,this.x=t.canonical.x,this.y=t.canonical.y,this.z=t.canonical.z,this.grid=e||new xr(fi,16,0),this.featureIndexArray=r||new qn;};function Ws(t,e){return e-t}$s.prototype.insert=function(t,e,r,n,i){var a=this.featureIndexArray.length;this.featureIndexArray.emplaceBack(r,n,i);for(var o=0;o<e.length;o++){for(var s=e[o],u=[1/0,1/0,-1/0,-1/0],p=0;p<s.length;p++){var l=s[p];u[0]=Math.min(u[0],l.x),u[1]=Math.min(u[1],l.y),u[2]=Math.max(u[2],l.x),u[3]=Math.max(u[3],l.y);}u[0]<fi&&u[1]<fi&&u[2]>=0&&u[3]>=0&&this.grid.insert(a,u[0],u[1],u[2],u[3]);}},$s.prototype.loadVTLayers=function(){return this.vtLayers||(this.vtLayers=new _o.VectorTile(new vs(this.rawTileData)).layers,this.sourceLayerCoder=new Gs(this.vtLayers?Object.keys(this.vtLayers).sort():["_geojsonTileLayer"])),this.vtLayers},$s.prototype.query=function(t,e,r){var n=this;this.loadVTLayers();for(var i=t.params||{},a=fi/t.tileSize/t.scale,o=Ge(i.filter),s=t.queryGeometry,u=t.queryPadding*a,p=1/0,l=1/0,c=-1/0,h=-1/0,f=0;f<s.length;f++)for(var y=s[f],d=0;d<y.length;d++){var m=y[d];p=Math.min(p,m.x),l=Math.min(l,m.y),c=Math.max(c,m.x),h=Math.max(h,m.y);}var v=this.grid.query(p-u,l-u,c+u,h+u);v.sort(Ws);for(var g,x={},b=function(u){var p=v[u];if(p!==g){g=p;var l=n.featureIndexArray.get(p),c=null;n.loadMatchingFeature(x,l.bucketIndex,l.sourceLayerIndex,l.featureIndex,o,i.layers,e,function(e,i){c||(c=mi(e));var o={};return e.id&&(o=r.getState(i.sourceLayer||"_geojsonTileLayer",e.id)),i.queryIntersectsFeature(s,e,o,c,n.z,t.transform,a,t.posMatrix)});}},_=0;_<v.length;_++)b(_);return x},$s.prototype.loadMatchingFeature=function(t,e,r,n,i,a,o,s){var u=this.bucketLayerIDs[e];if(!a||function(t,e){for(var r=0;r<t.length;r++)if(e.indexOf(t[r])>=0)return !0;return !1}(a,u)){var p=this.sourceLayerCoder.decode(r),l=this.vtLayers[p].feature(n);if(i(new qr(this.tileID.overscaledZ),l))for(var c=0;c<u.length;c++){var h=u[c];if(!(a&&a.indexOf(h)<0)){var f=o[h];if(f&&(!s||s(l,f))){var y=new Js(l,this.z,this.x,this.y);y.layer=f.serialize();var d=t[h];void 0===d&&(d=t[h]=[]),d.push({featureIndex:n,feature:y});}}}}},$s.prototype.lookupSymbolFeatures=function(t,e,r,n,i,a){var o={};this.loadVTLayers();for(var s=Ge(n),u=0,p=t;u<p.length;u+=1){var l=p[u];this.loadMatchingFeature(o,e,r,l,s,i,a);}return o},$s.prototype.hasLayer=function(t){for(var e=0,r=this.bucketLayerIDs;e<r.length;e+=1)for(var n=0,i=r[e];n<i.length;n+=1){if(t===i[n])return !0}return !1},kr("FeatureIndex",$s,{omit:["rawTileData","sourceLayerCoder"]});var Qs=function(t,e){this.tileID=t,this.uid=f(),this.uses=0,this.tileSize=e,this.buckets={},this.expirationTime=null,this.queryPadding=0,this.hasSymbolBuckets=!1,this.expiredRequestCount=0,this.state="loading";};Qs.prototype.registerFadeDuration=function(t){var e=t+this.timeAdded;e<S.now()||this.fadeEndTime&&e<this.fadeEndTime||(this.fadeEndTime=e);},Qs.prototype.wasRequested=function(){return "errored"===this.state||"loaded"===this.state||"reloading"===this.state},Qs.prototype.loadVectorData=function(t,e,r){if(this.hasData()&&this.unloadVectorData(),this.state="loaded",t){for(var n in t.featureIndex&&(this.latestFeatureIndex=t.featureIndex,t.rawTileData?(this.latestRawTileData=t.rawTileData,this.latestFeatureIndex.rawTileData=t.rawTileData):this.latestRawTileData&&(this.latestFeatureIndex.rawTileData=this.latestRawTileData)),this.collisionBoxArray=t.collisionBoxArray,this.buckets=function(t,e){var r={};if(!e)return r;for(var n=0,i=t;n<i.length;n+=1){var a=i[n],o=a.layerIds.map(function(t){return e.getLayer(t)}).filter(Boolean);if(0!==o.length){a.layers=o,a.stateDependentLayers=o.filter(function(t){return t.isStateDependent()});for(var s=0,u=o;s<u.length;s+=1)r[u[s].id]=a;}}return r}(t.buckets,e.style),this.hasSymbolBuckets=!1,this.buckets){var i=this.buckets[n];if(i instanceof Wo){if(this.hasSymbolBuckets=!0,!r)break;i.justReloaded=!0;}}for(var a in this.queryPadding=0,this.buckets){var o=this.buckets[a];this.queryPadding=Math.max(this.queryPadding,e.style.getLayer(a).queryRadius(o));}t.imageAtlas&&(this.imageAtlas=t.imageAtlas),t.glyphAtlasImage&&(this.glyphAtlasImage=t.glyphAtlasImage);}else this.collisionBoxArray=new Mn;},Qs.prototype.unloadVectorData=function(){for(var t in this.buckets)this.buckets[t].destroy();this.buckets={},this.imageAtlasTexture&&this.imageAtlasTexture.destroy(),this.imageAtlas&&(this.imageAtlas=null),this.glyphAtlasTexture&&this.glyphAtlasTexture.destroy(),this.latestFeatureIndex=null,this.state="unloaded";},Qs.prototype.unloadDEMData=function(){this.dem=null,this.neighboringTiles=null,this.state="unloaded";},Qs.prototype.getBucket=function(t){return this.buckets[t.id]},Qs.prototype.upload=function(t){for(var e in this.buckets){var r=this.buckets[e];r.uploadPending()&&r.upload(t);}var n=t.gl;this.imageAtlas&&!this.imageAtlas.uploaded&&(this.imageAtlasTexture=new ys(t,this.imageAtlas.image,n.RGBA),this.imageAtlas.uploaded=!0),this.glyphAtlasImage&&(this.glyphAtlasTexture=new ys(t,this.glyphAtlasImage,n.ALPHA),this.glyphAtlasImage=null);},Qs.prototype.queryRenderedFeatures=function(t,e,r,n,i,a,o,s){return this.latestFeatureIndex&&this.latestFeatureIndex.rawTileData?this.latestFeatureIndex.query({queryGeometry:r,scale:n,tileSize:this.tileSize,posMatrix:s,transform:a,params:i,queryPadding:this.queryPadding*o},t,e):{}},Qs.prototype.querySourceFeatures=function(t,e){if(this.latestFeatureIndex&&this.latestFeatureIndex.rawTileData){var r=this.latestFeatureIndex.loadVTLayers(),n=e?e.sourceLayer:"",i=r._geojsonTileLayer||r[n];if(i)for(var a=Ge(e&&e.filter),o=this.tileID.canonical,s=o.z,u=o.x,p=o.y,l={z:s,x:u,y:p},c=0;c<i.length;c++){var h=i.feature(c);if(a(new qr(this.tileID.overscaledZ),h)){var f=new Js(h,s,u,p);f.tile=l,t.push(f);}}}},Qs.prototype.clearMask=function(){this.segments&&(this.segments.destroy(),delete this.segments),this.maskedBoundsBuffer&&(this.maskedBoundsBuffer.destroy(),delete this.maskedBoundsBuffer),this.maskedIndexBuffer&&(this.maskedIndexBuffer.destroy(),delete this.maskedIndexBuffer);},Qs.prototype.setMask=function(t,e){if(!s(this.mask,t)&&(this.mask=t,this.clearMask(),!s(t,{0:!0}))){var r=new ln,n=new zn;this.segments=new Zn,this.segments.prepareSegment(0,r,n);for(var i=Object.keys(t),o=0;o<i.length;o++){var u=t[i[o]],p=fi>>u.z,l=new a(u.x*p,u.y*p),c=new a(l.x+p,l.y+p),h=this.segments.prepareSegment(4,r,n);r.emplaceBack(l.x,l.y,l.x,l.y),r.emplaceBack(c.x,l.y,c.x,l.y),r.emplaceBack(l.x,c.y,l.x,c.y),r.emplaceBack(c.x,c.y,c.x,c.y);var f=h.vertexLength;n.emplaceBack(f,f+1,f+2),n.emplaceBack(f+1,f+2,f+3),h.vertexLength+=4,h.primitiveLength+=2;}this.maskedBoundsBuffer=e.createVertexBuffer(r,Hs.members),this.maskedIndexBuffer=e.createIndexBuffer(n);}},Qs.prototype.hasData=function(){return "loaded"===this.state||"reloading"===this.state||"expired"===this.state},Qs.prototype.patternsLoaded=function(){return this.imageAtlas&&!!Object.keys(this.imageAtlas.patternPositions).length},Qs.prototype.setExpiryData=function(t){var e=this.expirationTime;if(t.cacheControl){var r=function(t){var e={};if(t.replace(/(?:^|(?:\s*\,\s*))([^\x00-\x20\(\)<>@\,;\:\\"\/\[\]\?\=\{\}\x7F]+)(?:\=(?:([^\x00-\x20\(\)<>@\,;\:\\"\/\[\]\?\=\{\}\x7F]+)|(?:\"((?:[^"\\]|\\.)*)\")))?/g,function(t,r,n,i){var a=n||i;return e[r]=!a||a.toLowerCase(),""}),e["max-age"]){var r=parseInt(e["max-age"],10);isNaN(r)?delete e["max-age"]:e["max-age"]=r;}return e}(t.cacheControl);r["max-age"]&&(this.expirationTime=Date.now()+1e3*r["max-age"]);}else t.expires&&(this.expirationTime=new Date(t.expires).getTime());if(this.expirationTime){var n=Date.now(),i=!1;if(this.expirationTime>n)i=!1;else if(e)if(this.expirationTime<e)i=!0;else{var a=this.expirationTime-e;a?this.expirationTime=n+Math.max(a,3e4):i=!0;}else i=!0;i?(this.expiredRequestCount++,this.state="expired"):this.expiredRequestCount=0;}},Qs.prototype.getExpiryTimeout=function(){if(this.expirationTime)return this.expiredRequestCount?1e3*(1<<Math.min(this.expiredRequestCount-1,31)):Math.min(this.expirationTime-(new Date).getTime(),Math.pow(2,31)-1)},Qs.prototype.setFeatureState=function(t,e){if(this.latestFeatureIndex&&this.latestFeatureIndex.rawTileData&&0!==Object.keys(t).length){var r=this.latestFeatureIndex.loadVTLayers();for(var n in this.buckets){var i=this.buckets[n],a=i.layers[0].sourceLayer||"_geojsonTileLayer",o=r[a],s=t[a];o&&s&&0!==Object.keys(s).length&&(i.update(s,o,this.imageAtlas&&this.imageAtlas.patternPositions||{}),e&&e.style&&(this.queryPadding=Math.max(this.queryPadding,e.style.getLayer(n).queryRadius(i))));}}},Qs.prototype.holdingForFade=function(){return void 0!==this.symbolFadeHoldUntil},Qs.prototype.symbolFadeFinished=function(){return !this.symbolFadeHoldUntil||this.symbolFadeHoldUntil<S.now()},Qs.prototype.clearFadeHold=function(){this.symbolFadeHoldUntil=void 0;},Qs.prototype.setHoldDuration=function(t){this.symbolFadeHoldUntil=S.now()+t;};var tu={horizontal:1,vertical:2,horizontalOnly:3},eu=function(){this.text="",this.sectionIndex=[],this.sections=[];};eu.fromFeature=function(t,e){var r=new eu;if(t instanceof ct)for(var n=0;n<t.sections.length;n++){var i=t.sections[n];r.sections.push({scale:i.scale||1,fontStack:i.fontStack||e}),r.text+=i.text;for(var a=0;a<i.text.length;a++)r.sectionIndex.push(n);}else{r.text=t,r.sections.push({scale:1,fontStack:e});for(var o=0;o<t.length;o++)r.sectionIndex.push(0);}return r},eu.prototype.length=function(){return this.text.length},eu.prototype.getSection=function(t){return this.sections[this.sectionIndex[t]]},eu.prototype.getCharCode=function(t){return this.text.charCodeAt(t)},eu.prototype.verticalizePunctuation=function(){this.text=function(t){for(var e="",r=0;r<t.length;r++){var n=t.charCodeAt(r+1)||null,i=t.charCodeAt(r-1)||null;n&&Tr(n)&&!Ro[t[r+1]]||i&&Tr(i)&&!Ro[t[r-1]]||!Ro[t[r]]?e+=t[r]:e+=Ro[t[r]];}return e}(this.text);},eu.prototype.trim=function(){for(var t=0,e=0;e<this.text.length&&ru[this.text.charCodeAt(e)];e++)t++;for(var r=this.text.length,n=this.text.length-1;n>=0&&n>=t&&ru[this.text.charCodeAt(n)];n--)r--;this.text=this.text.substring(t,r),this.sectionIndex=this.sectionIndex.slice(t,r);},eu.prototype.substring=function(t,e){var r=new eu;return r.text=this.text.substring(t,e),r.sectionIndex=this.sectionIndex.slice(t,e),r.sections=this.sections,r},eu.prototype.toString=function(){return this.text},eu.prototype.getMaxScale=function(){var t=this;return this.sectionIndex.reduce(function(e,r){return Math.max(e,t.sections[r].scale)},0)};var ru={9:!0,10:!0,11:!0,12:!0,13:!0,32:!0},nu={};function iu(t,e,r,n){var i=Math.pow(t-e,2);return n?t<e?i/2:2*i:i+Math.abs(r)*r}function au(t,e){var r=0;return 10===t&&(r-=1e4),40!==t&&65288!==t||(r+=50),41!==e&&65289!==e||(r+=50),r}function ou(t,e,r,n,i,a){for(var o=null,s=iu(e,r,i,a),u=0,p=n;u<p.length;u+=1){var l=p[u],c=iu(e-l.x,r,i,a)+l.badness;c<=s&&(o=l,s=c);}return {index:t,x:e,priorBreak:o,badness:s}}function su(t,e,r,n){if(!r)return [];if(!t)return [];for(var i,a=[],o=function(t,e,r,n){for(var i=0,a=0;a<t.length();a++){var o=t.getSection(a),s=n[o.fontStack],u=s&&s[t.getCharCode(a)];u&&(i+=u.metrics.advance*o.scale+e);}return i/Math.max(1,Math.ceil(i/r))}(t,e,r,n),s=0,u=0;u<t.length();u++){var p=t.getSection(u),l=t.getCharCode(u),c=n[p.fontStack],h=c&&c[l];h&&!ru[l]&&(s+=h.metrics.advance*p.scale+e),u<t.length()-1&&(nu[l]||!((i=l)<11904)&&(Vr["Bopomofo Extended"](i)||Vr.Bopomofo(i)||Vr["CJK Compatibility Forms"](i)||Vr["CJK Compatibility Ideographs"](i)||Vr["CJK Compatibility"](i)||Vr["CJK Radicals Supplement"](i)||Vr["CJK Strokes"](i)||Vr["CJK Symbols and Punctuation"](i)||Vr["CJK Unified Ideographs Extension A"](i)||Vr["CJK Unified Ideographs"](i)||Vr["Enclosed CJK Letters and Months"](i)||Vr["Halfwidth and Fullwidth Forms"](i)||Vr.Hiragana(i)||Vr["Ideographic Description Characters"](i)||Vr["Kangxi Radicals"](i)||Vr["Katakana Phonetic Extensions"](i)||Vr.Katakana(i)||Vr["Vertical Forms"](i)||Vr["Yi Radicals"](i)||Vr["Yi Syllables"](i)))&&a.push(ou(u+1,s,o,a,au(l,t.getCharCode(u+1)),!1));}return function t(e){return e?t(e.priorBreak).concat(e.index):[]}(ou(t.length(),s,o,a,0,!0))}function uu(t){var e=.5,r=.5;switch(t){case"right":case"top-right":case"bottom-right":e=1;break;case"left":case"top-left":case"bottom-left":e=0;}switch(t){case"bottom":case"bottom-right":case"bottom-left":r=1;break;case"top":case"top-right":case"top-left":r=0;}return {horizontalAlign:e,verticalAlign:r}}function pu(t,e,r,n,i){if(i){var a=t[n],o=e[a.fontStack],s=o&&o[a.glyph];if(s)for(var u=s.metrics.advance*a.scale,p=(t[n].x+u)*i,l=r;l<=n;l++)t[l].x-=p;}}nu[10]=!0,nu[32]=!0,nu[38]=!0,nu[40]=!0,nu[41]=!0,nu[43]=!0,nu[45]=!0,nu[47]=!0,nu[173]=!0,nu[183]=!0,nu[8203]=!0,nu[8208]=!0,nu[8211]=!0,nu[8231]=!0,t.createCommonjsModule=e,t.Point=a,t.window=self,t.browser=S,t.uuid=function(){return function t(e){return e?(e^16*Math.random()>>e/4).toString(16):([1e7]+-[1e3]+-4e3+-8e3+-1e11).replace(/[018]/g,t)}()},t.validateUuid=function(t){return !!t&&/^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t)},t.storageAvailable=function(t){try{var e=self[t];return e.setItem("_mapbox_test_",1),e.removeItem("_mapbox_test_"),!0}catch(t){return !1}},t.warnOnce=b,t.postData=function(t,e,r){var n=P(c(t,{method:"POST"}));return n.onerror=function(){r(new Error(n.statusText));},n.onload=function(){n.status>=200&&n.status<300?r(null,n.response):r(new V(n.statusText,n.status,t.url));},n.send(e),{cancel:function(){return n.abort()}}},t.getJSON=function(t,e){var r=P(t);return r.setRequestHeader("Accept","application/json"),r.onerror=function(){e(new Error(r.statusText));},r.onload=function(){if((r.status>=200&&r.status<300||0===r.status)&&r.response){var n;try{n=JSON.parse(r.response);}catch(t){return e(t)}e(null,n);}else 401===r.status&&t.url.match(/mapbox.com/)?e(new V(r.statusText+": you may have provided an invalid Mapbox access token. See https://www.mapbox.com/api-documentation/#access-tokens",r.status,t.url)):e(new V(r.statusText,r.status,t.url));},r.send(),{cancel:function(){return r.abort()}}},t.getImage=function(t,e){return M(t,function(t,r){if(t)e(t);else if(r){var n=new self.Image,i=self.URL||self.webkitURL;n.onload=function(){e(null,n),i.revokeObjectURL(n.src);};var a=new self.Blob([new Uint8Array(r.data)],{type:"image/png"});n.cacheControl=r.cacheControl,n.expires=r.expires,n.src=r.data.byteLength?i.createObjectURL(a):"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQYV2NgAAIAAAUAAarVyFEAAAAASUVORK5CYII=";}})},t.ResourceType=I,t.RGBAImage=la,t.potpack=os,t.ImagePosition=ss,t.Texture=ys,t.getArrayBuffer=M,t.parseGlyphPBF=function(t){return new vs(t).readFields(Fs,[])},t.isChar=Vr,t.asyncAll=function(t,e,r){if(!t.length)return r(null,[]);var n=t.length,i=new Array(t.length),a=null;t.forEach(function(t,o){e(t,function(t,e){t&&(a=t),i[o]=e,0==--n&&r(a,i);});});},t.AlphaImage=pa,t.styleSpec=L,t.endsWith=d,t.extend=c,t.sphericalToCartesian=function(t){var e=t[0],r=t[1],n=t[2];return r+=90,r*=Math.PI/180,n*=Math.PI/180,{x:e*Math.cos(r)*Math.sin(n),y:e*Math.sin(r)*Math.sin(n),z:e*Math.cos(n)}},t.Evented=O,t.validateStyle=yr,t.validateLight=dr,t.emitValidationErrors=gr,t.Color=at,t.number=Vt,t.Properties=en,t.Transitionable=Zr,t.Transitioning=Hr,t.PossiblyEvaluated=Kr,t.DataConstantProperty=Yr,t.uniqueId=f,t.Actor=js,t.pick=function(t,e){for(var r={},n=0;n<e.length;n++){var i=e[n];i in t&&(r[i]=t[i]);}return r},t.wrap=function(t,e,r){var n=r-e,i=((t-e)%n+n)%n+e;return i===e?r:i},t.clamp=l,t.Event=E,t.ErrorEvent=F,t.OverscaledTileID=Ns,t.EXTENT=fi,t.getCoordinatesCenter=function(t){for(var e=1/0,r=1/0,n=-1/0,a=-1/0,o=0;o<t.length;o++)e=Math.min(e,t[o].column),r=Math.min(r,t[o].row),n=Math.max(n,t[o].column),a=Math.max(a,t[o].row);var s=n-e,u=a-r,p=Math.max(s,u),l=Math.max(0,Math.floor(-Math.log(p)/Math.LN2));return new i((e+n)/2,(r+a)/2,0).zoomTo(l)},t.CanonicalTileID=qs,t.StructArrayLayout4i8=ln,t.rasterBoundsAttributes=Hs,t.SegmentVector=Zn,t.getVideo=function(t,e){var r,n,i=self.document.createElement("video");i.muted=!0,i.onloadstart=function(){e(null,i);};for(var a=0;a<t.length;a++){var o=self.document.createElement("source");r=t[a],n=void 0,(n=self.document.createElement("a")).href=r,(n.protocol!==self.document.location.protocol||n.host!==self.document.location.host)&&(i.crossOrigin="Anonymous"),o.src=t[a],i.appendChild(o);}return {cancel:function(){}}},t.ValidationError=D,t.bindAll=y,t.deepEqual=s,t.Tile=Qs,t.Coordinate=i,t.keysDifference=function(t,e){var r=[];for(var n in t)n in e||r.push(n);return r},t.SourceFeatureState=Ys,t.refProperties=["type","source","source-layer","minzoom","maxzoom","filter","layout"],t.create=function(){var t=new Ti(16);return t[0]=1,t[1]=0,t[2]=0,t[3]=0,t[4]=0,t[5]=1,t[6]=0,t[7]=0,t[8]=0,t[9]=0,t[10]=1,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,t},t.identity=function(t){return t[0]=1,t[1]=0,t[2]=0,t[3]=0,t[4]=0,t[5]=1,t[6]=0,t[7]=0,t[8]=0,t[9]=0,t[10]=1,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,t},t.invert=function(t,e){var r=e[0],n=e[1],i=e[2],a=e[3],o=e[4],s=e[5],u=e[6],p=e[7],l=e[8],c=e[9],h=e[10],f=e[11],y=e[12],d=e[13],m=e[14],v=e[15],g=r*s-n*o,x=r*u-i*o,b=r*p-a*o,_=n*u-i*s,w=n*p-a*s,A=i*p-a*u,k=l*d-c*y,z=l*m-h*y,S=l*v-f*y,B=c*m-h*d,I=c*v-f*d,V=h*v-f*m,P=g*V-x*I+b*B+_*S-w*z+A*k;return P?(P=1/P,t[0]=(s*V-u*I+p*B)*P,t[1]=(i*I-n*V-a*B)*P,t[2]=(d*A-m*w+v*_)*P,t[3]=(h*w-c*A-f*_)*P,t[4]=(u*S-o*V-p*z)*P,t[5]=(r*V-i*S+a*z)*P,t[6]=(m*b-y*A-v*x)*P,t[7]=(l*A-h*b+f*x)*P,t[8]=(o*I-s*S+p*k)*P,t[9]=(n*S-r*I-a*k)*P,t[10]=(y*w-d*b+v*g)*P,t[11]=(c*b-l*w-f*g)*P,t[12]=(s*z-o*B-u*k)*P,t[13]=(r*B-n*z+i*k)*P,t[14]=(d*x-y*_-m*g)*P,t[15]=(l*_-c*x+h*g)*P,t):null},t.multiply=function(t,e,r){var n=e[0],i=e[1],a=e[2],o=e[3],s=e[4],u=e[5],p=e[6],l=e[7],c=e[8],h=e[9],f=e[10],y=e[11],d=e[12],m=e[13],v=e[14],g=e[15],x=r[0],b=r[1],_=r[2],w=r[3];return t[0]=x*n+b*s+_*c+w*d,t[1]=x*i+b*u+_*h+w*m,t[2]=x*a+b*p+_*f+w*v,t[3]=x*o+b*l+_*y+w*g,x=r[4],b=r[5],_=r[6],w=r[7],t[4]=x*n+b*s+_*c+w*d,t[5]=x*i+b*u+_*h+w*m,t[6]=x*a+b*p+_*f+w*v,t[7]=x*o+b*l+_*y+w*g,x=r[8],b=r[9],_=r[10],w=r[11],t[8]=x*n+b*s+_*c+w*d,t[9]=x*i+b*u+_*h+w*m,t[10]=x*a+b*p+_*f+w*v,t[11]=x*o+b*l+_*y+w*g,x=r[12],b=r[13],_=r[14],w=r[15],t[12]=x*n+b*s+_*c+w*d,t[13]=x*i+b*u+_*h+w*m,t[14]=x*a+b*p+_*f+w*v,t[15]=x*o+b*l+_*y+w*g,t},t.translate=function(t,e,r){var n,i,a,o,s,u,p,l,c,h,f,y,d=r[0],m=r[1],v=r[2];return e===t?(t[12]=e[0]*d+e[4]*m+e[8]*v+e[12],t[13]=e[1]*d+e[5]*m+e[9]*v+e[13],t[14]=e[2]*d+e[6]*m+e[10]*v+e[14],t[15]=e[3]*d+e[7]*m+e[11]*v+e[15]):(n=e[0],i=e[1],a=e[2],o=e[3],s=e[4],u=e[5],p=e[6],l=e[7],c=e[8],h=e[9],f=e[10],y=e[11],t[0]=n,t[1]=i,t[2]=a,t[3]=o,t[4]=s,t[5]=u,t[6]=p,t[7]=l,t[8]=c,t[9]=h,t[10]=f,t[11]=y,t[12]=n*d+s*m+c*v+e[12],t[13]=i*d+u*m+h*v+e[13],t[14]=a*d+p*m+f*v+e[14],t[15]=o*d+l*m+y*v+e[15]),t},t.scale=function(t,e,r){var n=r[0],i=r[1],a=r[2];return t[0]=e[0]*n,t[1]=e[1]*n,t[2]=e[2]*n,t[3]=e[3]*n,t[4]=e[4]*i,t[5]=e[5]*i,t[6]=e[6]*i,t[7]=e[7]*i,t[8]=e[8]*a,t[9]=e[9]*a,t[10]=e[10]*a,t[11]=e[11]*a,t[12]=e[12],t[13]=e[13],t[14]=e[14],t[15]=e[15],t},t.rotateX=function(t,e,r){var n=Math.sin(r),i=Math.cos(r),a=e[4],o=e[5],s=e[6],u=e[7],p=e[8],l=e[9],c=e[10],h=e[11];return e!==t&&(t[0]=e[0],t[1]=e[1],t[2]=e[2],t[3]=e[3],t[12]=e[12],t[13]=e[13],t[14]=e[14],t[15]=e[15]),t[4]=a*i+p*n,t[5]=o*i+l*n,t[6]=s*i+c*n,t[7]=u*i+h*n,t[8]=p*i-a*n,t[9]=l*i-o*n,t[10]=c*i-s*n,t[11]=h*i-u*n,t},t.rotateZ=function(t,e,r){var n=Math.sin(r),i=Math.cos(r),a=e[0],o=e[1],s=e[2],u=e[3],p=e[4],l=e[5],c=e[6],h=e[7];return e!==t&&(t[8]=e[8],t[9]=e[9],t[10]=e[10],t[11]=e[11],t[12]=e[12],t[13]=e[13],t[14]=e[14],t[15]=e[15]),t[0]=a*i+p*n,t[1]=o*i+l*n,t[2]=s*i+c*n,t[3]=u*i+h*n,t[4]=p*i-a*n,t[5]=l*i-o*n,t[6]=c*i-s*n,t[7]=h*i-u*n,t},t.perspective=function(t,e,r,n,i){var a=1/Math.tan(e/2),o=1/(n-i);return t[0]=a/r,t[1]=0,t[2]=0,t[3]=0,t[4]=0,t[5]=a,t[6]=0,t[7]=0,t[8]=0,t[9]=0,t[10]=(i+n)*o,t[11]=-1,t[12]=0,t[13]=0,t[14]=2*i*n*o,t[15]=0,t},t.ortho=function(t,e,r,n,i,a,o){var s=1/(e-r),u=1/(n-i),p=1/(a-o);return t[0]=-2*s,t[1]=0,t[2]=0,t[3]=0,t[4]=0,t[5]=-2*u,t[6]=0,t[7]=0,t[8]=0,t[9]=0,t[10]=2*p,t[11]=0,t[12]=(e+r)*s,t[13]=(i+n)*u,t[14]=(o+a)*p,t[15]=1,t},t.create$1=Zi,t.normalize=Xi,t.transformMat4=Hi,t.forEach=Gi,t.getSizeData=Xo,t.evaluateSizeForFeature=function(t,e,r){var n=e;return "source"===t.functionType?r.lowerSize/Zo:"composite"===t.functionType?Vt(r.lowerSize/Zo,r.upperSize/Zo,n.uSizeT):n.uSize},t.evaluateSizeForZoom=function(t,e,r){if("constant"===t.functionType)return {uSizeT:0,uSize:t.layoutSize};if("source"===t.functionType)return {uSizeT:0,uSize:0};if("camera"===t.functionType){var n=t.propertyValue,i=t.zoomRange,a=t.sizeRange,o=l(De(n,r.specification).interpolationFactor(e,i.min,i.max),0,1);return {uSizeT:0,uSize:a.min+o*(a.max-a.min)}}var s=t.propertyValue,u=t.zoomRange;return {uSizeT:l(De(s,r.specification).interpolationFactor(e,u.min,u.max),0,1),uSize:0}},t.SIZE_PACK_FACTOR=Zo,t.addDynamicAttributes=Ko,t.properties=ts,t.WritingMode=tu,t.multiPolygonIntersectsBufferedPoint=xi,t.multiPolygonIntersectsMultiPolygon=bi,t.multiPolygonIntersectsBufferedMultiLine=_i,t.polygonIntersectsPolygon=function(t,e){for(var r=0;r<t.length;r++)if(Ii(e,t[r]))return !0;for(var n=0;n<e.length;n++)if(Ii(t,e[n]))return !0;return !!Ai(t,e)},t.distToSegmentSquared=Si,t.SymbolInstanceArray=Fn,t.StyleLayer=rn,t.createStyleLayer=function(t){return new as[t.type](t)},t.clone=g,t.filterObject=v,t.mapObject=m,t.registerForPluginAvailability=function(t){return Lr?t({pluginURL:Lr,completionCallback:Fr}):jr.once("pluginAvailable",t),t},t.evented=jr,t.ZoomHistory=Ir,t.createLayout=sn,t.ProgramConfiguration=pi,t.Uniform1i=Kn,t.Uniform1f=Yn,t.Uniform2f=$n,t.Uniform4f=Qn,t.Uniform3f=Wn,t.UniformMatrix4f=ri,t.create$2=Ei,t.fromRotation=function(t,e){var r=Math.sin(e),n=Math.cos(e);return t[0]=n,t[1]=r,t[2]=0,t[3]=-r,t[4]=n,t[5]=0,t[6]=0,t[7]=0,t[8]=1,t},t.create$3=Fi,t.length=Oi,t.fromValues=Li,t.normalize$1=Di,t.dot=ji,t.cross=Ui,t.transformMat3=function(t,e,r){var n=e[0],i=e[1],a=e[2];return t[0]=n*r[0]+i*r[3]+a*r[6],t[1]=n*r[1]+i*r[4]+a*r[7],t[2]=n*r[2]+i*r[5]+a*r[8],t},t.len=Ri,t.forEach$1=Ni,t.UniformColor=ti,t.StructArrayLayout2i4=pn,t.StructArrayLayout2ui4=Sn,t.StructArrayLayout3ui6=zn,t.StructArrayLayout1ui2=Bn,t.UnwrappedTileID=Rs,t.create$4=function(){var t=new Ti(4);return t[0]=1,t[1]=0,t[2]=0,t[3]=1,t},t.rotate=function(t,e,r){var n=e[0],i=e[1],a=e[2],o=e[3],s=Math.sin(r),u=Math.cos(r);return t[0]=n*u+a*s,t[1]=i*u+o*s,t[2]=n*-s+a*u,t[3]=i*-s+o*u,t},t.ease=p,t.bezier=u,t.EvaluationParameters=qr,t.setRTLTextPlugin=function(t,e){if(Or)throw new Error("setRTLTextPlugin cannot be called multiple times.");Or=!0,Lr=S.resolveURL(t),Fr=function(t){t?(Or=!1,Lr=null,e&&e(t)):Dr=!0;},jr.fire(new E("pluginAvailable",{pluginURL:Lr,completionCallback:Fr}));},t.values=function(t){var e=[];for(var r in t)e.push(t[r]);return e},t.featureFilter=Ge,t.Anchor=No,t.GLYPH_PBF_BORDER=Ds,t.shapeText=function(t,e,r,n,i,a,o,s,u,p,l){var c=eu.fromFeature(t,r);l===tu.vertical&&c.verticalizePunctuation();var h,f=[],y={positionedGlyphs:f,text:c,top:u[1],bottom:u[1],left:u[0],right:u[0],writingMode:l},d=Ur.processBidirectionalText,m=Ur.processStyledBidirectionalText;if(d&&1===c.sections.length){h=[];for(var v=0,g=d(c.toString(),su(c,s,n,e));v<g.length;v+=1){var x=g[v],b=new eu;b.text=x,b.sections=c.sections;for(var _=0;_<x.length;_++)b.sectionIndex.push(0);h.push(b);}}else if(m){h=[];for(var w=0,A=m(c.text,c.sectionIndex,su(c,s,n,e));w<A.length;w+=1){var k=A[w],z=new eu;z.text=k[0],z.sectionIndex=k[1],z.sections=c.sections,h.push(z);}}else h=function(t,e){for(var r=[],n=t.text,i=0,a=0,o=e;a<o.length;a+=1){var s=o[a];r.push(t.substring(i,s)),i=s;}return i<n.length&&r.push(t.substring(i,n.length)),r}(c,su(c,s,n,e));return function(t,e,r,n,i,a,o,s,u){for(var p=0,l=-17,c=0,h=t.positionedGlyphs,f="right"===a?1:"left"===a?0:.5,y=0,d=r;y<d.length;y+=1){var m=d[y];m.trim();var v=m.getMaxScale();if(m.length()){for(var g=h.length,x=0;x<m.length();x++){var b=m.getSection(x),_=m.getCharCode(x),w=24*(v-b.scale),A=e[b.fontStack],k=A&&A[_];k&&(Cr(_)&&o!==tu.horizontal?(h.push({glyph:_,x:p,y:w,vertical:!0,scale:b.scale,fontStack:b.fontStack}),p+=u*b.scale+s):(h.push({glyph:_,x:p,y:l+w,vertical:!1,scale:b.scale,fontStack:b.fontStack}),p+=k.metrics.advance*b.scale+s));}if(h.length!==g){var z=p-s;c=Math.max(z,c),pu(h,e,g,h.length-1,f);}p=0,l+=n*v;}else l+=n;}var S=uu(i),B=S.horizontalAlign,I=S.verticalAlign;!function(t,e,r,n,i,a,o){for(var s=(e-r)*i,u=(-n*o+.5)*a,p=0;p<t.length;p++)t[p].x+=s,t[p].y+=u;}(h,f,B,I,c,n,r.length);var V=l- -17;t.top+=-I*V,t.bottom=t.top+V,t.left+=-B*c,t.right=t.left+c;}(y,e,h,i,a,o,l,s,p),!!f.length&&(y.text=y.text.toString(),y)},t.shapeIcon=function(t,e,r){var n=uu(r),i=n.horizontalAlign,a=n.verticalAlign,o=e[0],s=e[1],u=o-t.displaySize[0]*i,p=u+t.displaySize[0],l=s-t.displaySize[1]*a;return {image:t,top:l,bottom:l+t.displaySize[1],left:u,right:p}},t.allowsVerticalWritingMode=Pr,t.allowsLetterSpacing=function(t){for(var e=0,r=t;e<r.length;e+=1)if(!Mr(r[e].charCodeAt(0)))return !1;return !0},t.classifyRings=Ja,t.SymbolBucket=Wo,t.Formatted=ct,t.register=kr,t.FeatureIndex=$s,t.CollisionBoxArray=Mn,t.DictionaryCoder=Gs,t.LineBucket=Io,t.FillBucket=Wa,t.FillExtrusionBucket=ao,t.ImageAtlas=ps,t.mvt=_o,t.Protobuf=vs,t.DEMData=Xs,t.vectorTile=_o,t.Point$1=a,t.pbf=vs,t.plugin=Ur;});

define(["./shared.js"],function(e){"use strict";function t(e){var r=typeof e;if("number"===r||"boolean"===r||"string"===r||null==e)return JSON.stringify(e);if(Array.isArray(e)){for(var n="[",o=0,i=e;o<i.length;o+=1){n+=t(i[o])+",";}return n+"]"}for(var a=Object.keys(e).sort(),s="{",l=0;l<a.length;l++)s+=JSON.stringify(a[l])+":"+t(e[a[l]])+",";return s+"}"}function r(r){for(var n="",o=0,i=e.refProperties;o<i.length;o+=1){n+="/"+t(r[i[o]]);}return n}var n=function(e){e&&this.replace(e);};function o(e,t,r,n,o){if(void 0===t.segment)return !0;for(var i=t,a=t.segment+1,s=0;s>-r/2;){if(--a<0)return !1;s-=e[a].dist(i),i=e[a];}s+=e[a].dist(e[a+1]),a++;for(var l=[],u=0;s<r/2;){var h=e[a-1],c=e[a],f=e[a+1];if(!f)return !1;var p=h.angleTo(c)-c.angleTo(f);for(p=Math.abs((p+3*Math.PI)%(2*Math.PI)-Math.PI),l.push({distance:s,angleDelta:p}),u+=p;s-l[0].distance>n;)u-=l.shift().angleDelta;if(u>o)return !1;a++,s+=c.dist(f);}return !0}function i(e){for(var t=0,r=0;r<e.length-1;r++)t+=e[r].dist(e[r+1]);return t}function a(e,t,r){return e?.6*t*r:0}function s(e,t){return Math.max(e?e.right-e.left:0,t?t.right-t.left:0)}function l(t,r,n,l,u,h){for(var c=a(n,u,h),f=s(n,l)*h,p=0,d=i(t)/2,g=0;g<t.length-1;g++){var m=t[g],v=t[g+1],y=m.dist(v);if(p+y>d){var x=(d-p)/y,w=e.number(m.x,v.x,x),M=e.number(m.y,v.y,x),S=new e.Anchor(w,M,v.angleTo(m),g);return S._round(),!c||o(t,S,f,c,r)?S:void 0}p+=y;}}function u(t,r,n,l,u,h,c,f,p){var d=a(l,h,c),g=s(l,u),m=g*c,v=0===t[0].x||t[0].x===p||0===t[0].y||t[0].y===p;return r-m<r/4&&(r=m+r/4),function t(r,n,a,s,l,u,h,c,f){var p=u/2;var d=i(r);var g=0,m=n-a;var v=[];for(var y=0;y<r.length-1;y++){for(var x=r[y],w=r[y+1],M=x.dist(w),S=w.angleTo(x);m+a<g+M;){var _=((m+=a)-g)/M,P=e.number(x.x,w.x,_),b=e.number(x.y,w.y,_);if(P>=0&&P<f&&b>=0&&b<f&&m-p>=0&&m+p<=d){var I=new e.Anchor(P,b,S,y);I._round(),s&&!o(r,I,u,s,l)||v.push(I);}}g+=M;}c||v.length||h||(v=t(r,g/2,a,s,l,u,h,!0,f));return v}(t,v?r/2*f%r:(g/2+2*h)*c*f%r,r,d,n,m,v,!1,p)}n.prototype.replace=function(e){this._layerConfigs={},this._layers={},this.update(e,[]);},n.prototype.update=function(t,n){for(var o=this,i=0,a=t;i<a.length;i+=1){var s=a[i];o._layerConfigs[s.id]=s;var l=o._layers[s.id]=e.createStyleLayer(s);l._featureFilter=e.featureFilter(l.filter);}for(var u=0,h=n;u<h.length;u+=1){var c=h[u];delete o._layerConfigs[c],delete o._layers[c];}this.familiesBySource={};for(var f=0,p=function(e){for(var t={},n=0;n<e.length;n++){var o=r(e[n]),i=t[o];i||(i=t[o]=[]),i.push(e[n]);}var a=[];for(var s in t)a.push(t[s]);return a}(e.values(this._layerConfigs));f<p.length;f+=1){var d=p[f].map(function(e){return o._layers[e.id]}),g=d[0];if("none"!==g.visibility){var m=g.source||"",v=o.familiesBySource[m];v||(v=o.familiesBySource[m]={});var y=g.sourceLayer||"_geojsonTileLayer",x=v[y];x||(x=v[y]=[]),x.push(d);}}};var h=function(t,r,n,o,i,a,s,l,u,h,c,f){var p=s.top*l-u,d=s.bottom*l+u,g=s.left*l-u,m=s.right*l+u;if(this.boxStartIndex=t.length,h){var v=d-p,y=m-g;v>0&&(v=Math.max(10*l,v),this._addLineCollisionCircles(t,r,n,n.segment,y,v,o,i,a,c));}else{if(f){var x=new e.Point(g,p),w=new e.Point(m,p),M=new e.Point(g,d),S=new e.Point(m,d),_=f*Math.PI/180;x._rotate(_),w._rotate(_),M._rotate(_),S._rotate(_),g=Math.min(x.x,w.x,M.x,S.x),m=Math.max(x.x,w.x,M.x,S.x),p=Math.min(x.y,w.y,M.y,S.y),d=Math.max(x.y,w.y,M.y,S.y);}t.emplaceBack(n.x,n.y,g,p,m,d,o,i,a,0,0);}this.boxEndIndex=t.length;};h.prototype._addLineCollisionCircles=function(e,t,r,n,o,i,a,s,l,u){var h=i/2,c=Math.floor(o/h)||1,f=1+.4*Math.log(u)/Math.LN2,p=Math.floor(c*f/2),d=-i/2,g=r,m=n+1,v=d,y=-o/2,x=y-o/4;do{if(--m<0){if(v>y)return;m=0;break}v-=t[m].dist(g),g=t[m];}while(v>x);for(var w=t[m].dist(t[m+1]),M=-p;M<c+p;M++){var S=M*h,_=y+S;if(S<0&&(_+=S),S>o&&(_+=S-o),!(_<v)){for(;v+w<_;){if(v+=w,++m+1>=t.length)return;w=t[m].dist(t[m+1]);}var P=_-v,b=t[m],I=t[m+1].sub(b)._unit()._mult(P)._add(b)._round(),T=Math.abs(_-d)<h?0:.8*(_-d);e.emplaceBack(I.x,I.y,-i/2,-i/2,i/2,i/2,a,s,l,i/2,T);}}};var c=p,f=p;function p(e,t){if(!(this instanceof p))return new p(e,t);if(this.data=e||[],this.length=this.data.length,this.compare=t||d,this.length>0)for(var r=(this.length>>1)-1;r>=0;r--)this._down(r);}function d(e,t){return e<t?-1:e>t?1:0}function g(t,r,n){void 0===r&&(r=1),void 0===n&&(n=!1);for(var o=1/0,i=1/0,a=-1/0,s=-1/0,l=t[0],u=0;u<l.length;u++){var h=l[u];(!u||h.x<o)&&(o=h.x),(!u||h.y<i)&&(i=h.y),(!u||h.x>a)&&(a=h.x),(!u||h.y>s)&&(s=h.y);}var f=a-o,p=s-i,d=Math.min(f,p),g=d/2,y=new c(null,m);if(0===d)return new e.Point(o,i);for(var x=o;x<a;x+=d)for(var w=i;w<s;w+=d)y.push(new v(x+g,w+g,g,t));for(var M=function(e){for(var t=0,r=0,n=0,o=e[0],i=0,a=o.length,s=a-1;i<a;s=i++){var l=o[i],u=o[s],h=l.x*u.y-u.x*l.y;r+=(l.x+u.x)*h,n+=(l.y+u.y)*h,t+=3*h;}return new v(r/t,n/t,0,e)}(t),S=y.length;y.length;){var _=y.pop();(_.d>M.d||!M.d)&&(M=_,n&&console.log("found best %d after %d probes",Math.round(1e4*_.d)/1e4,S)),_.max-M.d<=r||(g=_.h/2,y.push(new v(_.p.x-g,_.p.y-g,g,t)),y.push(new v(_.p.x+g,_.p.y-g,g,t)),y.push(new v(_.p.x-g,_.p.y+g,g,t)),y.push(new v(_.p.x+g,_.p.y+g,g,t)),S+=4);}return n&&(console.log("num probes: "+S),console.log("best distance: "+M.d)),M.p}function m(e,t){return t.max-e.max}function v(t,r,n,o){this.p=new e.Point(t,r),this.h=n,this.d=function(t,r){for(var n=!1,o=1/0,i=0;i<r.length;i++)for(var a=r[i],s=0,l=a.length,u=l-1;s<l;u=s++){var h=a[s],c=a[u];h.y>t.y!=c.y>t.y&&t.x<(c.x-h.x)*(t.y-h.y)/(c.y-h.y)+h.x&&(n=!n),o=Math.min(o,e.distToSegmentSquared(t,h,c));}return (n?1:-1)*Math.sqrt(o)}(this.p,o),this.max=this.d+this.h*Math.SQRT2;}p.prototype={push:function(e){this.data.push(e),this.length++,this._up(this.length-1);},pop:function(){if(0!==this.length){var e=this.data[0];return this.length--,this.length>0&&(this.data[0]=this.data[this.length],this._down(0)),this.data.pop(),e}},peek:function(){return this.data[0]},_up:function(e){for(var t=this.data,r=this.compare,n=t[e];e>0;){var o=e-1>>1,i=t[o];if(r(n,i)>=0)break;t[e]=i,e=o;}t[e]=n;},_down:function(e){for(var t=this.data,r=this.compare,n=this.length>>1,o=t[e];e<n;){var i=1+(e<<1),a=i+1,s=t[i];if(a<this.length&&r(t[a],s)<0&&(i=a,s=t[a]),r(s,o)>=0)break;t[e]=s,e=i;}t[e]=o;}},c.default=f;var y=e.createCommonjsModule(function(e){e.exports=function(e,t){var r,n,o,i,a,s,l,u;for(r=3&e.length,n=e.length-r,o=t,a=3432918353,s=461845907,u=0;u<n;)l=255&e.charCodeAt(u)|(255&e.charCodeAt(++u))<<8|(255&e.charCodeAt(++u))<<16|(255&e.charCodeAt(++u))<<24,++u,o=27492+(65535&(i=5*(65535&(o=(o^=l=(65535&(l=(l=(65535&l)*a+(((l>>>16)*a&65535)<<16)&4294967295)<<15|l>>>17))*s+(((l>>>16)*s&65535)<<16)&4294967295)<<13|o>>>19))+((5*(o>>>16)&65535)<<16)&4294967295))+((58964+(i>>>16)&65535)<<16);switch(l=0,r){case 3:l^=(255&e.charCodeAt(u+2))<<16;case 2:l^=(255&e.charCodeAt(u+1))<<8;case 1:o^=l=(65535&(l=(l=(65535&(l^=255&e.charCodeAt(u)))*a+(((l>>>16)*a&65535)<<16)&4294967295)<<15|l>>>17))*s+(((l>>>16)*s&65535)<<16)&4294967295;}return o^=e.length,o=2246822507*(65535&(o^=o>>>16))+((2246822507*(o>>>16)&65535)<<16)&4294967295,o=3266489909*(65535&(o^=o>>>13))+((3266489909*(o>>>16)&65535)<<16)&4294967295,(o^=o>>>16)>>>0};}),x=e.createCommonjsModule(function(e){e.exports=function(e,t){for(var r,n=e.length,o=t^n,i=0;n>=4;)r=1540483477*(65535&(r=255&e.charCodeAt(i)|(255&e.charCodeAt(++i))<<8|(255&e.charCodeAt(++i))<<16|(255&e.charCodeAt(++i))<<24))+((1540483477*(r>>>16)&65535)<<16),o=1540483477*(65535&o)+((1540483477*(o>>>16)&65535)<<16)^(r=1540483477*(65535&(r^=r>>>24))+((1540483477*(r>>>16)&65535)<<16)),n-=4,++i;switch(n){case 3:o^=(255&e.charCodeAt(i+2))<<16;case 2:o^=(255&e.charCodeAt(i+1))<<8;case 1:o=1540483477*(65535&(o^=255&e.charCodeAt(i)))+((1540483477*(o>>>16)&65535)<<16);}return o=1540483477*(65535&(o^=o>>>13))+((1540483477*(o>>>16)&65535)<<16),(o^=o>>>15)>>>0};}),w=y,M=y,S=x;function _(t,r,n,o,i,a){t.createArrays();var s=512*t.overscaling;t.tilePixelRatio=e.EXTENT/s,t.compareText={},t.iconsNeedLinear=!1;var l=t.layers[0].layout,u=t.layers[0]._unevaluatedLayout._values,h={};if("composite"===t.textSizeData.functionType){var c=t.textSizeData.zoomRange,f=c.min,p=c.max;h.compositeTextSizes=[u["text-size"].possiblyEvaluate(new e.EvaluationParameters(f)),u["text-size"].possiblyEvaluate(new e.EvaluationParameters(p))];}if("composite"===t.iconSizeData.functionType){var d=t.iconSizeData.zoomRange,g=d.min,m=d.max;h.compositeIconSizes=[u["icon-size"].possiblyEvaluate(new e.EvaluationParameters(g)),u["icon-size"].possiblyEvaluate(new e.EvaluationParameters(m))];}h.layoutTextSize=u["text-size"].possiblyEvaluate(new e.EvaluationParameters(t.zoom+1)),h.layoutIconSize=u["icon-size"].possiblyEvaluate(new e.EvaluationParameters(t.zoom+1)),h.textMaxSize=u["text-size"].possiblyEvaluate(new e.EvaluationParameters(18));for(var v=24*l.get("text-line-height"),y="map"===l.get("text-rotation-alignment")&&"point"!==l.get("symbol-placement"),x=l.get("text-keep-upright"),w=0,M=t.features;w<M.length;w+=1){var S=M[w],_=l.get("text-font").evaluate(S,{}).join(","),b=n,I={},T=S.text;if(T){var k=T instanceof e.Formatted?T.toString():T,z=l.get("text-offset").evaluate(S,{}).map(function(e){return 24*e}),C=24*l.get("text-letter-spacing").evaluate(S,{}),E=e.allowsLetterSpacing(k)?C:0,L=l.get("text-anchor").evaluate(S,{}),A=l.get("text-justify").evaluate(S,{}),D="point"===l.get("symbol-placement")?24*l.get("text-max-width").evaluate(S,{}):0;I.horizontal=e.shapeText(T,r,_,D,v,L,A,E,z,24,e.WritingMode.horizontal),e.allowsVerticalWritingMode(k)&&y&&x&&(I.vertical=e.shapeText(T,r,_,D,v,L,A,E,z,24,e.WritingMode.vertical));}var O=void 0;if(S.icon){var N=o[S.icon];N&&(O=e.shapeIcon(i[S.icon],l.get("icon-offset").evaluate(S,{}),l.get("icon-anchor").evaluate(S,{})),void 0===t.sdfIcons?t.sdfIcons=N.sdf:t.sdfIcons!==N.sdf&&e.warnOnce("Style sheet warning: Cannot mix SDF and non-SDF icons in one buffer"),N.pixelRatio!==t.pixelRatio?t.iconsNeedLinear=!0:0!==l.get("icon-rotate").constantOr(1)&&(t.iconsNeedLinear=!0));}(I.horizontal||O)&&P(t,S,I,O,b,h);}a&&t.generateCollisionDebugBuffers();}function P(t,r,n,o,i,a){var s=a.layoutTextSize.evaluate(r,{}),c=a.layoutIconSize.evaluate(r,{}),f=a.textMaxSize.evaluate(r,{});void 0===f&&(f=s);var p=t.layers[0].layout,d=p.get("text-offset").evaluate(r,{}),m=p.get("icon-offset").evaluate(r,{}),v=s/24,y=t.tilePixelRatio*v,x=t.tilePixelRatio*f/24,M=t.tilePixelRatio*c,S=t.tilePixelRatio*p.get("symbol-spacing"),_=p.get("text-padding")*t.tilePixelRatio,P=p.get("icon-padding")*t.tilePixelRatio,k=p.get("text-max-angle")/180*Math.PI,z="map"===p.get("text-rotation-alignment")&&"point"!==p.get("symbol-placement"),C="map"===p.get("icon-rotation-alignment")&&"point"!==p.get("symbol-placement"),E=p.get("symbol-placement"),L=S/2,A=function(s,l){l.x<0||l.x>=e.EXTENT||l.y<0||l.y>=e.EXTENT||function(t,r,n,o,i,a,s,l,u,c,f,p,d,g,m,v,y,x,M,S,_){var P,T,k=t.addToLineVertexArray(r,n),z=0,C=0,E=0,L=w(o.horizontal?o.horizontal.text:""),A=[];if(o.horizontal){var D=a.layout.get("text-rotate").evaluate(M,{});P=new h(s,n,r,l,u,c,o.horizontal,f,p,d,t.overscaling,D),C+=I(t,r,o.horizontal,a,d,M,g,k,o.vertical?e.WritingMode.horizontal:e.WritingMode.horizontalOnly,A,S,_),o.vertical&&(E+=I(t,r,o.vertical,a,d,M,g,k,e.WritingMode.vertical,A,S,_));}var O=P?P.boxStartIndex:t.collisionBoxArray.length,N=P?P.boxEndIndex:t.collisionBoxArray.length;if(i){var R=function(t,r,n,o,i,a){var s,l,u,h,c=r.image,f=n.layout,p=r.top-1/c.pixelRatio,d=r.left-1/c.pixelRatio,g=r.bottom+1/c.pixelRatio,m=r.right+1/c.pixelRatio;if("none"!==f.get("icon-text-fit")&&i){var v=m-d,y=g-p,x=f.get("text-size").evaluate(a,{})/24,w=i.left*x,M=i.right*x,S=i.top*x,_=M-w,P=i.bottom*x-S,b=f.get("icon-text-fit-padding")[0],I=f.get("icon-text-fit-padding")[1],T=f.get("icon-text-fit-padding")[2],k=f.get("icon-text-fit-padding")[3],z="width"===f.get("icon-text-fit")?.5*(P-y):0,C="height"===f.get("icon-text-fit")?.5*(_-v):0,E="width"===f.get("icon-text-fit")||"both"===f.get("icon-text-fit")?_:v,L="height"===f.get("icon-text-fit")||"both"===f.get("icon-text-fit")?P:y;s=new e.Point(w+C-k,S+z-b),l=new e.Point(w+C+I+E,S+z-b),u=new e.Point(w+C+I+E,S+z+T+L),h=new e.Point(w+C-k,S+z+T+L);}else s=new e.Point(d,p),l=new e.Point(m,p),u=new e.Point(m,g),h=new e.Point(d,g);var A=n.layout.get("icon-rotate").evaluate(a,{})*Math.PI/180;if(A){var D=Math.sin(A),O=Math.cos(A),N=[O,-D,D,O];s._matMult(N),l._matMult(N),h._matMult(N),u._matMult(N);}return [{tl:s,tr:l,bl:h,br:u,tex:c.paddedRect,writingMode:void 0,glyphOffset:[0,0]}]}(0,i,a,0,o.horizontal,M),F=a.layout.get("icon-rotate").evaluate(M,{});T=new h(s,n,r,l,u,c,i,m,v,!1,t.overscaling,F),z=4*R.length;var B=t.iconSizeData,Z=null;"source"===B.functionType?(Z=[e.SIZE_PACK_FACTOR*a.layout.get("icon-size").evaluate(M,{})])[0]>b&&e.warnOnce(t.layerIds[0]+': Value for "icon-size" is >= 256. Reduce your "icon-size".'):"composite"===B.functionType&&((Z=[e.SIZE_PACK_FACTOR*_.compositeIconSizes[0].evaluate(M,{}),e.SIZE_PACK_FACTOR*_.compositeIconSizes[1].evaluate(M,{})])[0]>b||Z[1]>b)&&e.warnOnce(t.layerIds[0]+': Value for "icon-size" is >= 256. Reduce your "icon-size".'),t.addSymbols(t.icon,R,Z,x,y,M,!1,r,k.lineStartIndex,k.lineLength);}var j=T?T.boxStartIndex:t.collisionBoxArray.length,G=T?T.boxEndIndex:t.collisionBoxArray.length;t.glyphOffsetArray.length>=e.SymbolBucket.MAX_GLYPHS&&e.warnOnce("Too many glyphs being rendered in a tile. See https://github.com/mapbox/mapbox-gl-js/issues/2907");t.symbolInstances.emplaceBack(r.x,r.y,A.length>0?A[0]:-1,A.length>1?A[1]:-1,L,O,N,j,G,l,C,E,z,0);}(t,l,s,n,o,t.layers[0],t.collisionBoxArray,r.index,r.sourceLayerIndex,t.index,y,_,z,d,M,P,C,m,r,i,a);};if("line"===E)for(var D=0,O=function(t,r,n,o,i){for(var a=[],s=0;s<t.length;s++)for(var l=t[s],u=void 0,h=0;h<l.length-1;h++){var c=l[h],f=l[h+1];c.x<r&&f.x<r||(c.x<r?c=new e.Point(r,c.y+(f.y-c.y)*((r-c.x)/(f.x-c.x)))._round():f.x<r&&(f=new e.Point(r,c.y+(f.y-c.y)*((r-c.x)/(f.x-c.x)))._round()),c.y<n&&f.y<n||(c.y<n?c=new e.Point(c.x+(f.x-c.x)*((n-c.y)/(f.y-c.y)),n)._round():f.y<n&&(f=new e.Point(c.x+(f.x-c.x)*((n-c.y)/(f.y-c.y)),n)._round()),c.x>=o&&f.x>=o||(c.x>=o?c=new e.Point(o,c.y+(f.y-c.y)*((o-c.x)/(f.x-c.x)))._round():f.x>=o&&(f=new e.Point(o,c.y+(f.y-c.y)*((o-c.x)/(f.x-c.x)))._round()),c.y>=i&&f.y>=i||(c.y>=i?c=new e.Point(c.x+(f.x-c.x)*((i-c.y)/(f.y-c.y)),i)._round():f.y>=i&&(f=new e.Point(c.x+(f.x-c.x)*((i-c.y)/(f.y-c.y)),i)._round()),u&&c.equals(u[u.length-1])||(u=[c],a.push(u)),u.push(f)))));}return a}(r.geometry,0,0,e.EXTENT,e.EXTENT);D<O.length;D+=1)for(var N=O[D],R=0,F=u(N,S,k,n.vertical||n.horizontal,o,24,x,t.overscaling,e.EXTENT);R<F.length;R+=1){var B=F[R],Z=n.horizontal;Z&&T(t,Z.text,L,B)||A(N,B);}else if("line-center"===E)for(var j=0,G=r.geometry;j<G.length;j+=1){var J=G[j];if(J.length>1){var X=l(J,k,n.vertical||n.horizontal,o,24,x);X&&A(J,X);}}else if("Polygon"===r.type)for(var V=0,W=e.classifyRings(r.geometry,0);V<W.length;V+=1){var Y=W[V],q=g(Y,16);A(Y[0],new e.Anchor(q.x,q.y,0));}else if("LineString"===r.type)for(var K=0,U=r.geometry;K<U.length;K+=1){var H=U[K];A(H,new e.Anchor(H[0].x,H[0].y,0));}else if("Point"===r.type)for(var Q=0,$=r.geometry;Q<$.length;Q+=1)for(var ee=0,te=$[Q];ee<te.length;ee+=1){var re=te[ee];A([re],new e.Anchor(re.x,re.y,0));}}w.murmur3=M,w.murmur2=S;var b=65535;function I(t,r,n,o,i,a,s,l,u,h,c,f){var p=function(t,r,n,o,i,a){for(var s=n.layout.get("text-rotate").evaluate(i,{})*Math.PI/180,l=n.layout.get("text-offset").evaluate(i,{}).map(function(e){return 24*e}),u=r.positionedGlyphs,h=[],c=0;c<u.length;c++){var f=u[c],p=a[f.fontStack],d=p&&p[f.glyph];if(d){var g=d.rect;if(g){var m=e.GLYPH_PBF_BORDER+1,v=d.metrics.advance*f.scale/2,y=o?[f.x+v,f.y]:[0,0],x=o?[0,0]:[f.x+v+l[0],f.y+l[1]],w=(d.metrics.left-m)*f.scale-v+x[0],M=(-d.metrics.top-m)*f.scale+x[1],S=w+g.w*f.scale,_=M+g.h*f.scale,P=new e.Point(w,M),b=new e.Point(S,M),I=new e.Point(w,_),T=new e.Point(S,_);if(o&&f.vertical){var k=new e.Point(-v,v),z=-Math.PI/2,C=new e.Point(5,0);P._rotateAround(z,k)._add(C),b._rotateAround(z,k)._add(C),I._rotateAround(z,k)._add(C),T._rotateAround(z,k)._add(C);}if(s){var E=Math.sin(s),L=Math.cos(s),A=[L,-E,E,L];P._matMult(A),b._matMult(A),I._matMult(A),T._matMult(A);}h.push({tl:P,tr:b,bl:I,br:T,tex:g,writingMode:r.writingMode,glyphOffset:y});}}}return h}(0,n,o,i,a,c),d=t.textSizeData,g=null;return "source"===d.functionType?(g=[e.SIZE_PACK_FACTOR*o.layout.get("text-size").evaluate(a,{})])[0]>b&&e.warnOnce(t.layerIds[0]+': Value for "text-size" is >= 256. Reduce your "text-size".'):"composite"===d.functionType&&((g=[e.SIZE_PACK_FACTOR*f.compositeTextSizes[0].evaluate(a,{}),e.SIZE_PACK_FACTOR*f.compositeTextSizes[1].evaluate(a,{})])[0]>b||g[1]>b)&&e.warnOnce(t.layerIds[0]+': Value for "text-size" is >= 256. Reduce your "text-size".'),t.addSymbols(t.text,p,g,s,i,a,u,r,l.lineStartIndex,l.lineLength),h.push(t.text.placedSymbolArray.length-1),4*p.length}function T(e,t,r,n){var o=e.compareText;if(t in o){for(var i=o[t],a=i.length-1;a>=0;a--)if(n.dist(i[a])<r)return !0}else o[t]=[];return o[t].push(n),!1}var k=function(t){var r={},n=[];for(var o in t){var i=t[o],a=r[o]={};for(var s in i){var l=i[+s];if(l&&0!==l.bitmap.width&&0!==l.bitmap.height){var u={x:0,y:0,w:l.bitmap.width+2,h:l.bitmap.height+2};n.push(u),a[s]={rect:u,metrics:l.metrics};}}}var h=e.potpack(n),c=h.w,f=h.h,p=new e.AlphaImage({width:c||1,height:f||1});for(var d in t){var g=t[d];for(var m in g){var v=g[+m];if(v&&0!==v.bitmap.width&&0!==v.bitmap.height){var y=r[d][m].rect;e.AlphaImage.copy(v.bitmap,p,{x:0,y:0},{x:y.x+1,y:y.y+1},v.bitmap);}}}this.image=p,this.positions=r;};e.register("GlyphAtlas",k);var z=function(t){this.tileID=new e.OverscaledTileID(t.tileID.overscaledZ,t.tileID.wrap,t.tileID.canonical.z,t.tileID.canonical.x,t.tileID.canonical.y),this.uid=t.uid,this.zoom=t.zoom,this.pixelRatio=t.pixelRatio,this.tileSize=t.tileSize,this.source=t.source,this.overscaling=this.tileID.overscaleFactor(),this.showCollisionBoxes=t.showCollisionBoxes,this.collectResourceTiming=!!t.collectResourceTiming;};function C(t,r){for(var n=new e.EvaluationParameters(r),o=0,i=t;o<i.length;o+=1){i[o].recalculate(n);}}z.prototype.parse=function(t,r,n,o){var i=this;this.status="parsing",this.data=t,this.collisionBoxArray=new e.CollisionBoxArray;var a=new e.DictionaryCoder(Object.keys(t.layers).sort()),s=new e.FeatureIndex(this.tileID);s.bucketLayerIDs=[];var l,u,h,c,f={},p={featureIndex:s,iconDependencies:{},patternDependencies:{},glyphDependencies:{}},d=r.familiesBySource[this.source];for(var g in d){var m=t.layers[g];if(m){1===m.version&&e.warnOnce('Vector tile source "'+i.source+'" layer "'+g+'" does not use vector tile spec v2 and therefore may have some rendering errors.');for(var v=a.encode(g),y=[],x=0;x<m.length;x++){var w=m.feature(x);y.push({feature:w,index:x,sourceLayerIndex:v});}for(var M=0,S=d[g];M<S.length;M+=1){var P=S[M],b=P[0];if(!(b.minzoom&&i.zoom<Math.floor(b.minzoom)))if(!(b.maxzoom&&i.zoom>=b.maxzoom))if("none"!==b.visibility)C(P,i.zoom),(f[b.id]=b.createBucket({index:s.bucketLayerIDs.length,layers:P,zoom:i.zoom,pixelRatio:i.pixelRatio,overscaling:i.overscaling,collisionBoxArray:i.collisionBoxArray,sourceLayerIndex:v,sourceID:i.source})).populate(y,p),s.bucketLayerIDs.push(P.map(function(e){return e.id}));}}}var I=e.mapObject(p.glyphDependencies,function(e){return Object.keys(e).map(Number)});Object.keys(I).length?n.send("getGlyphs",{uid:this.uid,stacks:I},function(e,t){l||(l=e,u=t,E.call(i));}):u={};var T=Object.keys(p.iconDependencies);T.length?n.send("getImages",{icons:T},function(e,t){l||(l=e,h=t,E.call(i));}):h={};var z=Object.keys(p.patternDependencies);function E(){if(l)return o(l);if(u&&h&&c){var t=new k(u),r=new e.ImageAtlas(h,c);for(var n in f){var i=f[n];i instanceof e.SymbolBucket?(C(i.layers,this.zoom),_(i,u,t.positions,h,r.iconPositions,this.showCollisionBoxes)):i.hasPattern&&(i instanceof e.LineBucket||i instanceof e.FillBucket||i instanceof e.FillExtrusionBucket)&&(C(i.layers,this.zoom),i.addFeatures(p,r.patternPositions));}this.status="done",o(null,{buckets:e.values(f).filter(function(e){return !e.isEmpty()}),featureIndex:s,collisionBoxArray:this.collisionBoxArray,glyphAtlasImage:t.image,imageAtlas:r});}}z.length?n.send("getImages",{icons:z},function(e,t){l||(l=e,c=t,E.call(i));}):c={},E.call(this);};var E="undefined"!=typeof performance,L={getEntriesByName:function(e){return !!(E&&performance&&performance.getEntriesByName)&&performance.getEntriesByName(e)},mark:function(e){return !!(E&&performance&&performance.mark)&&performance.mark(e)},measure:function(e,t,r){return !!(E&&performance&&performance.measure)&&performance.measure(e,t,r)},clearMarks:function(e){return !!(E&&performance&&performance.clearMarks)&&performance.clearMarks(e)},clearMeasures:function(e){return !!(E&&performance&&performance.clearMeasures)&&performance.clearMeasures(e)}},A=function(e){this._marks={start:[e.url,"start"].join("#"),end:[e.url,"end"].join("#"),measure:e.url.toString()},L.mark(this._marks.start);};function D(t,r){var n=e.getArrayBuffer(t.request,function(t,n){t?r(t):n&&r(null,{vectorTile:new e.mvt.VectorTile(new e.Protobuf(n.data)),rawData:n.data,cacheControl:n.cacheControl,expires:n.expires});});return function(){n.cancel(),r();}}A.prototype.finish=function(){L.mark(this._marks.end);var e=L.getEntriesByName(this._marks.measure);return 0===e.length&&(L.measure(this._marks.measure,this._marks.start,this._marks.end),e=L.getEntriesByName(this._marks.measure),L.clearMarks(this._marks.start),L.clearMarks(this._marks.end),L.clearMeasures(this._marks.measure)),e},L.Performance=A;var O=function(e,t,r){this.actor=e,this.layerIndex=t,this.loadVectorData=r||D,this.loading={},this.loaded={};};O.prototype.loadTile=function(t,r){var n=this,o=t.uid;this.loading||(this.loading={});var i=!!(t&&t.request&&t.request.collectResourceTiming)&&new L.Performance(t.request),a=this.loading[o]=new z(t);a.abort=this.loadVectorData(t,function(t,s){if(delete n.loading[o],t||!s)return r(t);var l=s.rawData,u={};s.expires&&(u.expires=s.expires),s.cacheControl&&(u.cacheControl=s.cacheControl);var h={};if(i){var c=i.finish();c&&(h.resourceTiming=JSON.parse(JSON.stringify(c)));}a.vectorTile=s.vectorTile,a.parse(s.vectorTile,n.layerIndex,n.actor,function(t,n){if(t||!n)return r(t);r(null,e.extend({rawTileData:l.slice(0)},n,u,h));}),n.loaded=n.loaded||{},n.loaded[o]=a;});},O.prototype.reloadTile=function(e,t){var r=this.loaded,n=e.uid,o=this;if(r&&r[n]){var i=r[n];i.showCollisionBoxes=e.showCollisionBoxes;var a=function(e,r){var n=i.reloadCallback;n&&(delete i.reloadCallback,i.parse(i.vectorTile,o.layerIndex,o.actor,n)),t(e,r);};"parsing"===i.status?i.reloadCallback=a:"done"===i.status&&i.parse(i.vectorTile,this.layerIndex,this.actor,a);}},O.prototype.abortTile=function(e,t){var r=this.loading,n=e.uid;r&&r[n]&&r[n].abort&&(r[n].abort(),delete r[n]),t();},O.prototype.removeTile=function(e,t){var r=this.loaded,n=e.uid;r&&r[n]&&delete r[n],t();};var N=function(){this.loaded={};};N.prototype.loadTile=function(t,r){var n=t.uid,o=t.encoding,i=t.rawImageData,a=new e.DEMData(n,i,o);this.loaded=this.loaded||{},this.loaded[n]=a,r(null,a);},N.prototype.removeTile=function(e){var t=this.loaded,r=e.uid;t&&t[r]&&delete t[r];};var R={RADIUS:6378137,FLATTENING:1/298.257223563,POLAR_RADIUS:6356752.3142};function F(e){var t=0;if(e&&e.length>0){t+=Math.abs(B(e[0]));for(var r=1;r<e.length;r++)t-=Math.abs(B(e[r]));}return t}function B(e){var t,r,n,o,i,a,s=0,l=e.length;if(l>2){for(a=0;a<l;a++)a===l-2?(n=l-2,o=l-1,i=0):a===l-1?(n=l-1,o=0,i=1):(n=a,o=a+1,i=a+2),t=e[n],r=e[o],s+=(Z(e[i][0])-Z(t[0]))*Math.sin(Z(r[1]));s=s*R.RADIUS*R.RADIUS/2;}return s}function Z(e){return e*Math.PI/180}var j={geometry:function e(t){var r,n=0;switch(t.type){case"Polygon":return F(t.coordinates);case"MultiPolygon":for(r=0;r<t.coordinates.length;r++)n+=F(t.coordinates[r]);return n;case"Point":case"MultiPoint":case"LineString":case"MultiLineString":return 0;case"GeometryCollection":for(r=0;r<t.geometries.length;r++)n+=e(t.geometries[r]);return n}},ring:B},G=function e(t,r){switch(t&&t.type||null){case"FeatureCollection":return t.features=t.features.map(J(e,r)),t;case"Feature":return t.geometry=e(t.geometry,r),t;case"Polygon":case"MultiPolygon":return function(e,t){"Polygon"===e.type?e.coordinates=X(e.coordinates,t):"MultiPolygon"===e.type&&(e.coordinates=e.coordinates.map(J(X,t)));return e}(t,r);default:return t}};function J(e,t){return function(r){return e(r,t)}}function X(e,t){t=!!t,e[0]=V(e[0],t);for(var r=1;r<e.length;r++)e[r]=V(e[r],!t);return e}function V(e,t){return function(e){return j.ring(e)>=0}(e)===t?e:e.reverse()}var W=e.mvt.VectorTileFeature.prototype.toGeoJSON,Y=function(t){this._feature=t,this.extent=e.EXTENT,this.type=t.type,this.properties=t.tags,"id"in t&&!isNaN(t.id)&&(this.id=parseInt(t.id,10));};Y.prototype.loadGeometry=function(){if(1===this._feature.type){for(var t=[],r=0,n=this._feature.geometry;r<n.length;r+=1){var o=n[r];t.push([new e.Point(o[0],o[1])]);}return t}for(var i=[],a=0,s=this._feature.geometry;a<s.length;a+=1){for(var l=[],u=0,h=s[a];u<h.length;u+=1){var c=h[u];l.push(new e.Point(c[0],c[1]));}i.push(l);}return i},Y.prototype.toGeoJSON=function(e,t,r){return W.call(this,e,t,r)};var q=function(t){this.layers={_geojsonTileLayer:this},this.name="_geojsonTileLayer",this.extent=e.EXTENT,this.length=t.length,this._features=t;};q.prototype.feature=function(e){return new Y(this._features[e])};var K=e.vectorTile.VectorTileFeature,U=H;function H(e,t){this.options=t||{},this.features=e,this.length=e.length;}function Q(e,t){this.id="number"==typeof e.id?e.id:void 0,this.type=e.type,this.rawGeometry=1===e.type?[e.geometry]:e.geometry,this.properties=e.tags,this.extent=t||4096;}H.prototype.feature=function(e){return new Q(this.features[e],this.options.extent)},Q.prototype.loadGeometry=function(){var t=this.rawGeometry;this.geometry=[];for(var r=0;r<t.length;r++){for(var n=t[r],o=[],i=0;i<n.length;i++)o.push(new e.Point$1(n[i][0],n[i][1]));this.geometry.push(o);}return this.geometry},Q.prototype.bbox=function(){this.geometry||this.loadGeometry();for(var e=this.geometry,t=1/0,r=-1/0,n=1/0,o=-1/0,i=0;i<e.length;i++)for(var a=e[i],s=0;s<a.length;s++){var l=a[s];t=Math.min(t,l.x),r=Math.max(r,l.x),n=Math.min(n,l.y),o=Math.max(o,l.y);}return [t,n,r,o]},Q.prototype.toGeoJSON=K.prototype.toGeoJSON;var $=ne,ee=ne,te=function(e,t){t=t||{};var r={};for(var n in e)r[n]=new U(e[n].features,t),r[n].name=n,r[n].version=t.version,r[n].extent=t.extent;return ne({layers:r})},re=U;function ne(t){var r=new e.pbf;return function(e,t){for(var r in e.layers)t.writeMessage(3,oe,e.layers[r]);}(t,r),r.finish()}function oe(e,t){var r;t.writeVarintField(15,e.version||1),t.writeStringField(1,e.name||""),t.writeVarintField(5,e.extent||4096);var n={keys:[],values:[],keycache:{},valuecache:{}};for(r=0;r<e.length;r++)n.feature=e.feature(r),t.writeMessage(2,ie,n);var o=n.keys;for(r=0;r<o.length;r++)t.writeStringField(3,o[r]);var i=n.values;for(r=0;r<i.length;r++)t.writeMessage(4,he,i[r]);}function ie(e,t){var r=e.feature;void 0!==r.id&&t.writeVarintField(1,r.id),t.writeMessage(2,ae,e),t.writeVarintField(3,r.type),t.writeMessage(4,ue,r);}function ae(e,t){var r=e.feature,n=e.keys,o=e.values,i=e.keycache,a=e.valuecache;for(var s in r.properties){var l=i[s];void 0===l&&(n.push(s),l=n.length-1,i[s]=l),t.writeVarint(l);var u=r.properties[s],h=typeof u;"string"!==h&&"boolean"!==h&&"number"!==h&&(u=JSON.stringify(u));var c=h+":"+u,f=a[c];void 0===f&&(o.push(u),f=o.length-1,a[c]=f),t.writeVarint(f);}}function se(e,t){return (t<<3)+(7&e)}function le(e){return e<<1^e>>31}function ue(e,t){for(var r=e.loadGeometry(),n=e.type,o=0,i=0,a=r.length,s=0;s<a;s++){var l=r[s],u=1;1===n&&(u=l.length),t.writeVarint(se(1,u));for(var h=3===n?l.length-1:l.length,c=0;c<h;c++){1===c&&1!==n&&t.writeVarint(se(2,h-1));var f=l[c].x-o,p=l[c].y-i;t.writeVarint(le(f)),t.writeVarint(le(p)),o+=f,i+=p;}3===n&&t.writeVarint(se(7,0));}}function he(e,t){var r=typeof e;"string"===r?t.writeStringField(1,e):"boolean"===r?t.writeBooleanField(7,e):"number"===r&&(e%1!=0?t.writeDoubleField(3,e):e<0?t.writeSVarintField(6,e):t.writeVarintField(5,e));}function ce(e,t,r,n,o,i){if(!(o-n<=r)){var a=Math.floor((n+o)/2);!function e(t,r,n,o,i,a){for(;i>o;){if(i-o>600){var s=i-o+1,l=n-o+1,u=Math.log(s),h=.5*Math.exp(2*u/3),c=.5*Math.sqrt(u*h*(s-h)/s)*(l-s/2<0?-1:1),f=Math.max(o,Math.floor(n-l*h/s+c)),p=Math.min(i,Math.floor(n+(s-l)*h/s+c));e(t,r,n,f,p,a);}var d=r[2*n+a],g=o,m=i;for(fe(t,r,o,n),r[2*i+a]>d&&fe(t,r,o,i);g<m;){for(fe(t,r,g,m),g++,m--;r[2*g+a]<d;)g++;for(;r[2*m+a]>d;)m--;}r[2*o+a]===d?fe(t,r,o,m):fe(t,r,++m,i),m<=n&&(o=m+1),n<=m&&(i=m-1);}}(e,t,a,n,o,i%2),ce(e,t,r,n,a-1,i+1),ce(e,t,r,a+1,o,i+1);}}function fe(e,t,r,n){pe(e,r,n),pe(t,2*r,2*n),pe(t,2*r+1,2*n+1);}function pe(e,t,r){var n=e[t];e[t]=e[r],e[r]=n;}function de(e,t,r,n){var o=e-r,i=t-n;return o*o+i*i}function ge(e,t,r,n,o){return new me(e,t,r,n,o)}function me(e,t,r,n,o){t=t||ve,r=r||ye,o=o||Array,this.nodeSize=n||64,this.points=e,this.ids=new o(e.length),this.coords=new o(2*e.length);for(var i=0;i<e.length;i++)this.ids[i]=i,this.coords[2*i]=t(e[i]),this.coords[2*i+1]=r(e[i]);ce(this.ids,this.coords,this.nodeSize,0,this.ids.length-1,0);}function ve(e){return e[0]}function ye(e){return e[1]}function xe(e){this.options=be(Object.create(this.options),e),this.trees=new Array(this.options.maxZoom+1);}function we(e,t,r,n,o){return {x:e,y:t,zoom:1/0,id:r,parentId:-1,numPoints:n,properties:o}}function Me(e){return {type:"Feature",id:e.id,properties:Se(e),geometry:{type:"Point",coordinates:[(n=e.x,360*(n-.5)),(t=e.y,r=(180-360*t)*Math.PI/180,360*Math.atan(Math.exp(r))/Math.PI-90)]}};var t,r,n;}function Se(e){var t=e.numPoints,r=t>=1e4?Math.round(t/1e3)+"k":t>=1e3?Math.round(t/100)/10+"k":t;return be(be({},e.properties),{cluster:!0,cluster_id:e.id,point_count:t,point_count_abbreviated:r})}function _e(e){return e/360+.5}function Pe(e){var t=Math.sin(e*Math.PI/180),r=.5-.25*Math.log((1+t)/(1-t))/Math.PI;return r<0?0:r>1?1:r}function be(e,t){for(var r in t)e[r]=t[r];return e}function Ie(e){return e.x}function Te(e){return e.y}function ke(e,t,r,n,o,i){var a=o-r,s=i-n;if(0!==a||0!==s){var l=((e-r)*a+(t-n)*s)/(a*a+s*s);l>1?(r=o,n=i):l>0&&(r+=a*l,n+=s*l);}return (a=e-r)*a+(s=t-n)*s}function ze(e,t,r,n){var o={id:void 0===e?null:e,type:t,geometry:r,tags:n,minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0};return function(e){var t=e.geometry,r=e.type;if("Point"===r||"MultiPoint"===r||"LineString"===r)Ce(e,t);else if("Polygon"===r||"MultiLineString"===r)for(var n=0;n<t.length;n++)Ce(e,t[n]);else if("MultiPolygon"===r)for(n=0;n<t.length;n++)for(var o=0;o<t[n].length;o++)Ce(e,t[n][o]);}(o),o}function Ce(e,t){for(var r=0;r<t.length;r+=3)e.minX=Math.min(e.minX,t[r]),e.minY=Math.min(e.minY,t[r+1]),e.maxX=Math.max(e.maxX,t[r]),e.maxY=Math.max(e.maxY,t[r+1]);}function Ee(e,t,r,n){if(t.geometry){var o=t.geometry.coordinates,i=t.geometry.type,a=Math.pow(r.tolerance/((1<<r.maxZoom)*r.extent),2),s=[],l=t.id;if(r.promoteId?l=t.properties[r.promoteId]:r.generateId&&(l=n||0),"Point"===i)Le(o,s);else if("MultiPoint"===i)for(var u=0;u<o.length;u++)Le(o[u],s);else if("LineString"===i)Ae(o,s,a,!1);else if("MultiLineString"===i){if(r.lineMetrics){for(u=0;u<o.length;u++)s=[],Ae(o[u],s,a,!1),e.push(ze(l,"LineString",s,t.properties));return}De(o,s,a,!1);}else if("Polygon"===i)De(o,s,a,!0);else{if("MultiPolygon"!==i){if("GeometryCollection"===i){for(u=0;u<t.geometry.geometries.length;u++)Ee(e,{id:l,geometry:t.geometry.geometries[u],properties:t.properties},r,n);return}throw new Error("Input data is not a valid GeoJSON object.")}for(u=0;u<o.length;u++){var h=[];De(o[u],h,a,!0),s.push(h);}}e.push(ze(l,i,s,t.properties));}}function Le(e,t){t.push(Oe(e[0])),t.push(Ne(e[1])),t.push(0);}function Ae(e,t,r,n){for(var o,i,a=0,s=0;s<e.length;s++){var l=Oe(e[s][0]),u=Ne(e[s][1]);t.push(l),t.push(u),t.push(0),s>0&&(a+=n?(o*u-l*i)/2:Math.sqrt(Math.pow(l-o,2)+Math.pow(u-i,2))),o=l,i=u;}var h=t.length-3;t[2]=1,function e(t,r,n,o){for(var i,a=o,s=n-r>>1,l=n-r,u=t[r],h=t[r+1],c=t[n],f=t[n+1],p=r+3;p<n;p+=3){var d=ke(t[p],t[p+1],u,h,c,f);if(d>a)i=p,a=d;else if(d===a){var g=Math.abs(p-s);g<l&&(i=p,l=g);}}a>o&&(i-r>3&&e(t,r,i,o),t[i+2]=a,n-i>3&&e(t,i,n,o));}(t,0,h,r),t[h+2]=1,t.size=Math.abs(a),t.start=0,t.end=t.size;}function De(e,t,r,n){for(var o=0;o<e.length;o++){var i=[];Ae(e[o],i,r,n),t.push(i);}}function Oe(e){return e/360+.5}function Ne(e){var t=Math.sin(e*Math.PI/180),r=.5-.25*Math.log((1+t)/(1-t))/Math.PI;return r<0?0:r>1?1:r}function Re(e,t,r,n,o,i,a,s){if(n/=t,i>=(r/=t)&&a<n)return e;if(a<r||i>=n)return null;for(var l=[],u=0;u<e.length;u++){var h=e[u],c=h.geometry,f=h.type,p=0===o?h.minX:h.minY,d=0===o?h.maxX:h.maxY;if(p>=r&&d<n)l.push(h);else if(!(d<r||p>=n)){var g=[];if("Point"===f||"MultiPoint"===f)Fe(c,g,r,n,o);else if("LineString"===f)Be(c,g,r,n,o,!1,s.lineMetrics);else if("MultiLineString"===f)je(c,g,r,n,o,!1);else if("Polygon"===f)je(c,g,r,n,o,!0);else if("MultiPolygon"===f)for(var m=0;m<c.length;m++){var v=[];je(c[m],v,r,n,o,!0),v.length&&g.push(v);}if(g.length){if(s.lineMetrics&&"LineString"===f){for(m=0;m<g.length;m++)l.push(ze(h.id,f,g[m],h.tags));continue}"LineString"!==f&&"MultiLineString"!==f||(1===g.length?(f="LineString",g=g[0]):f="MultiLineString"),"Point"!==f&&"MultiPoint"!==f||(f=3===g.length?"Point":"MultiPoint"),l.push(ze(h.id,f,g,h.tags));}}}return l.length?l:null}function Fe(e,t,r,n,o){for(var i=0;i<e.length;i+=3){var a=e[i+o];a>=r&&a<=n&&(t.push(e[i]),t.push(e[i+1]),t.push(e[i+2]));}}function Be(e,t,r,n,o,i,a){for(var s,l,u=Ze(e),h=0===o?Je:Xe,c=e.start,f=0;f<e.length-3;f+=3){var p=e[f],d=e[f+1],g=e[f+2],m=e[f+3],v=e[f+4],y=0===o?p:d,x=0===o?m:v,w=!1;a&&(s=Math.sqrt(Math.pow(p-m,2)+Math.pow(d-v,2))),y<r?x>=r&&(l=h(u,p,d,m,v,r),a&&(u.start=c+s*l)):y>=n?x<n&&(l=h(u,p,d,m,v,n),a&&(u.start=c+s*l)):Ge(u,p,d,g),x<r&&y>=r&&(l=h(u,p,d,m,v,r),w=!0),x>n&&y<=n&&(l=h(u,p,d,m,v,n),w=!0),!i&&w&&(a&&(u.end=c+s*l),t.push(u),u=Ze(e)),a&&(c+=s);}var M=e.length-3;p=e[M],d=e[M+1],g=e[M+2],(y=0===o?p:d)>=r&&y<=n&&Ge(u,p,d,g),M=u.length-3,i&&M>=3&&(u[M]!==u[0]||u[M+1]!==u[1])&&Ge(u,u[0],u[1],u[2]),u.length&&t.push(u);}function Ze(e){var t=[];return t.size=e.size,t.start=e.start,t.end=e.end,t}function je(e,t,r,n,o,i){for(var a=0;a<e.length;a++)Be(e[a],t,r,n,o,i,!1);}function Ge(e,t,r,n){e.push(t),e.push(r),e.push(n);}function Je(e,t,r,n,o,i){var a=(i-t)/(n-t);return e.push(i),e.push(r+(o-r)*a),e.push(1),a}function Xe(e,t,r,n,o,i){var a=(i-r)/(o-r);return e.push(t+(n-t)*a),e.push(i),e.push(1),a}function Ve(e,t){for(var r=[],n=0;n<e.length;n++){var o,i=e[n],a=i.type;if("Point"===a||"MultiPoint"===a||"LineString"===a)o=We(i.geometry,t);else if("MultiLineString"===a||"Polygon"===a){o=[];for(var s=0;s<i.geometry.length;s++)o.push(We(i.geometry[s],t));}else if("MultiPolygon"===a)for(o=[],s=0;s<i.geometry.length;s++){for(var l=[],u=0;u<i.geometry[s].length;u++)l.push(We(i.geometry[s][u],t));o.push(l);}r.push(ze(i.id,a,o,i.tags));}return r}function We(e,t){var r=[];r.size=e.size,void 0!==e.start&&(r.start=e.start,r.end=e.end);for(var n=0;n<e.length;n+=3)r.push(e[n]+t,e[n+1],e[n+2]);return r}function Ye(e,t){if(e.transformed)return e;var r,n,o,i=1<<e.z,a=e.x,s=e.y;for(r=0;r<e.features.length;r++){var l=e.features[r],u=l.geometry,h=l.type;if(l.geometry=[],1===h)for(n=0;n<u.length;n+=2)l.geometry.push(qe(u[n],u[n+1],t,i,a,s));else for(n=0;n<u.length;n++){var c=[];for(o=0;o<u[n].length;o+=2)c.push(qe(u[n][o],u[n][o+1],t,i,a,s));l.geometry.push(c);}}return e.transformed=!0,e}function qe(e,t,r,n,o,i){return [Math.round(r*(e*n-o)),Math.round(r*(t*n-i))]}function Ke(e,t,r,n,o){for(var i=t===o.maxZoom?0:o.tolerance/((1<<t)*o.extent),a={features:[],numPoints:0,numSimplified:0,numFeatures:0,source:null,x:r,y:n,z:t,transformed:!1,minX:2,minY:1,maxX:-1,maxY:0},s=0;s<e.length;s++){a.numFeatures++,Ue(a,e[s],i,o);var l=e[s].minX,u=e[s].minY,h=e[s].maxX,c=e[s].maxY;l<a.minX&&(a.minX=l),u<a.minY&&(a.minY=u),h>a.maxX&&(a.maxX=h),c>a.maxY&&(a.maxY=c);}return a}function Ue(e,t,r,n){var o=t.geometry,i=t.type,a=[];if("Point"===i||"MultiPoint"===i)for(var s=0;s<o.length;s+=3)a.push(o[s]),a.push(o[s+1]),e.numPoints++,e.numSimplified++;else if("LineString"===i)He(a,o,e,r,!1,!1);else if("MultiLineString"===i||"Polygon"===i)for(s=0;s<o.length;s++)He(a,o[s],e,r,"Polygon"===i,0===s);else if("MultiPolygon"===i)for(var l=0;l<o.length;l++){var u=o[l];for(s=0;s<u.length;s++)He(a,u[s],e,r,!0,0===s);}if(a.length){var h=t.tags||null;if("LineString"===i&&n.lineMetrics){for(var c in h={},t.tags)h[c]=t.tags[c];h.mapbox_clip_start=o.start/o.size,h.mapbox_clip_end=o.end/o.size;}var f={geometry:a,type:"Polygon"===i||"MultiPolygon"===i?3:"LineString"===i||"MultiLineString"===i?2:1,tags:h};null!==t.id&&(f.id=t.id),e.features.push(f);}}function He(e,t,r,n,o,i){var a=n*n;if(n>0&&t.size<(o?a:n))r.numPoints+=t.length/3;else{for(var s=[],l=0;l<t.length;l+=3)(0===n||t[l+2]>a)&&(r.numSimplified++,s.push(t[l]),s.push(t[l+1])),r.numPoints++;o&&function(e,t){for(var r=0,n=0,o=e.length,i=o-2;n<o;i=n,n+=2)r+=(e[n]-e[i])*(e[n+1]+e[i+1]);if(r>0===t)for(n=0,o=e.length;n<o/2;n+=2){var a=e[n],s=e[n+1];e[n]=e[o-2-n],e[n+1]=e[o-1-n],e[o-2-n]=a,e[o-1-n]=s;}}(s,i),e.push(s);}}function Qe(e,t){var r=(t=this.options=function(e,t){for(var r in t)e[r]=t[r];return e}(Object.create(this.options),t)).debug;if(r&&console.time("preprocess data"),t.maxZoom<0||t.maxZoom>24)throw new Error("maxZoom should be in the 0-24 range");if(t.promoteId&&t.generateId)throw new Error("promoteId and generateId cannot be used together.");var n=function(e,t){var r=[];if("FeatureCollection"===e.type)for(var n=0;n<e.features.length;n++)Ee(r,e.features[n],t,n);else"Feature"===e.type?Ee(r,e,t):Ee(r,{geometry:e},t);return r}(e,t);this.tiles={},this.tileCoords=[],r&&(console.timeEnd("preprocess data"),console.log("index: maxZoom: %d, maxPoints: %d",t.indexMaxZoom,t.indexMaxPoints),console.time("generate tiles"),this.stats={},this.total=0),(n=function(e,t){var r=t.buffer/t.extent,n=e,o=Re(e,1,-1-r,r,0,-1,2,t),i=Re(e,1,1-r,2+r,0,-1,2,t);return (o||i)&&(n=Re(e,1,-r,1+r,0,-1,2,t)||[],o&&(n=Ve(o,1).concat(n)),i&&(n=n.concat(Ve(i,-1)))),n}(n,t)).length&&this.splitTile(n,0,0,0),r&&(n.length&&console.log("features: %d, points: %d",this.tiles[0].numFeatures,this.tiles[0].numPoints),console.timeEnd("generate tiles"),console.log("tiles generated:",this.total,JSON.stringify(this.stats)));}function $e(e,t,r){return 32*((1<<e)*r+t)+e}function et(e,t){var r=e.tileID.canonical;if(!this._geoJSONIndex)return t(null,null);var n=this._geoJSONIndex.getTile(r.z,r.x,r.y);if(!n)return t(null,null);var o=new q(n.features),i=$(o);0===i.byteOffset&&i.byteLength===i.buffer.byteLength||(i=new Uint8Array(i)),t(null,{vectorTile:o,rawData:i.buffer});}$.fromVectorTileJs=ee,$.fromGeojsonVt=te,$.GeoJSONWrapper=re,me.prototype={range:function(e,t,r,n){return function(e,t,r,n,o,i,a){for(var s,l,u=[0,e.length-1,0],h=[];u.length;){var c=u.pop(),f=u.pop(),p=u.pop();if(f-p<=a)for(var d=p;d<=f;d++)s=t[2*d],l=t[2*d+1],s>=r&&s<=o&&l>=n&&l<=i&&h.push(e[d]);else{var g=Math.floor((p+f)/2);s=t[2*g],l=t[2*g+1],s>=r&&s<=o&&l>=n&&l<=i&&h.push(e[g]);var m=(c+1)%2;(0===c?r<=s:n<=l)&&(u.push(p),u.push(g-1),u.push(m)),(0===c?o>=s:i>=l)&&(u.push(g+1),u.push(f),u.push(m));}}return h}(this.ids,this.coords,e,t,r,n,this.nodeSize)},within:function(e,t,r){return function(e,t,r,n,o,i){for(var a=[0,e.length-1,0],s=[],l=o*o;a.length;){var u=a.pop(),h=a.pop(),c=a.pop();if(h-c<=i)for(var f=c;f<=h;f++)de(t[2*f],t[2*f+1],r,n)<=l&&s.push(e[f]);else{var p=Math.floor((c+h)/2),d=t[2*p],g=t[2*p+1];de(d,g,r,n)<=l&&s.push(e[p]);var m=(u+1)%2;(0===u?r-o<=d:n-o<=g)&&(a.push(c),a.push(p-1),a.push(m)),(0===u?r+o>=d:n+o>=g)&&(a.push(p+1),a.push(h),a.push(m));}}return s}(this.ids,this.coords,e,t,r,this.nodeSize)}},xe.prototype={options:{minZoom:0,maxZoom:16,radius:40,extent:512,nodeSize:64,log:!1,reduce:null,initial:function(){return {}},map:function(e){return e}},load:function(e){var t=this.options.log;t&&console.time("total time");var r="prepare "+e.length+" points";t&&console.time(r),this.points=e;for(var n,o,i,a=[],s=0;s<e.length;s++)e[s].geometry&&a.push((n=e[s],o=s,void 0,{x:_e((i=n.geometry.coordinates)[0]),y:Pe(i[1]),zoom:1/0,index:o,parentId:-1}));this.trees[this.options.maxZoom+1]=ge(a,Ie,Te,this.options.nodeSize,Float32Array),t&&console.timeEnd(r);for(var l=this.options.maxZoom;l>=this.options.minZoom;l--){var u=+Date.now();a=this._cluster(a,l),this.trees[l]=ge(a,Ie,Te,this.options.nodeSize,Float32Array),t&&console.log("z%d: %d clusters in %dms",l,a.length,+Date.now()-u);}return t&&console.timeEnd("total time"),this},getClusters:function(e,t){var r=((e[0]+180)%360+360)%360-180,n=Math.max(-90,Math.min(90,e[1])),o=180===e[2]?180:((e[2]+180)%360+360)%360-180,i=Math.max(-90,Math.min(90,e[3]));if(e[2]-e[0]>=360)r=-180,o=180;else if(r>o){var a=this.getClusters([r,n,180,i],t),s=this.getClusters([-180,n,o,i],t);return a.concat(s)}for(var l=this.trees[this._limitZoom(t)],u=l.range(_e(r),Pe(i),_e(o),Pe(n)),h=[],c=0;c<u.length;c++){var f=l.points[u[c]];h.push(f.numPoints?Me(f):this.points[f.index]);}return h},getChildren:function(e){var t=e>>5,r=e%32,n="No cluster with the specified id.",o=this.trees[r];if(!o)throw new Error(n);var i=o.points[t];if(!i)throw new Error(n);for(var a=this.options.radius/(this.options.extent*Math.pow(2,r-1)),s=o.within(i.x,i.y,a),l=[],u=0;u<s.length;u++){var h=o.points[s[u]];h.parentId===e&&l.push(h.numPoints?Me(h):this.points[h.index]);}if(0===l.length)throw new Error(n);return l},getLeaves:function(e,t,r){t=t||10,r=r||0;var n=[];return this._appendLeaves(n,e,t,r,0),n},getTile:function(e,t,r){var n=this.trees[this._limitZoom(e)],o=Math.pow(2,e),i=this.options.extent,a=this.options.radius/i,s=(r-a)/o,l=(r+1+a)/o,u={features:[]};return this._addTileFeatures(n.range((t-a)/o,s,(t+1+a)/o,l),n.points,t,r,o,u),0===t&&this._addTileFeatures(n.range(1-a/o,s,1,l),n.points,o,r,o,u),t===o-1&&this._addTileFeatures(n.range(0,s,a/o,l),n.points,-1,r,o,u),u.features.length?u:null},getClusterExpansionZoom:function(e){for(var t=e%32-1;t<this.options.maxZoom;){var r=this.getChildren(e);if(t++,1!==r.length)break;e=r[0].properties.cluster_id;}return t},_appendLeaves:function(e,t,r,n,o){for(var i=this.getChildren(t),a=0;a<i.length;a++){var s=i[a].properties;if(s&&s.cluster?o+s.point_count<=n?o+=s.point_count:o=this._appendLeaves(e,s.cluster_id,r,n,o):o<n?o++:e.push(i[a]),e.length===r)break}return o},_addTileFeatures:function(e,t,r,n,o,i){for(var a=0;a<e.length;a++){var s=t[e[a]],l={type:1,geometry:[[Math.round(this.options.extent*(s.x*o-r)),Math.round(this.options.extent*(s.y*o-n))]],tags:s.numPoints?Se(s):this.points[s.index].properties},u=s.numPoints?s.id:this.points[s.index].id;void 0!==u&&(l.id=u),i.features.push(l);}},_limitZoom:function(e){return Math.max(this.options.minZoom,Math.min(e,this.options.maxZoom+1))},_cluster:function(e,t){for(var r=[],n=this.options.radius/(this.options.extent*Math.pow(2,t)),o=0;o<e.length;o++){var i=e[o];if(!(i.zoom<=t)){i.zoom=t;var a=this.trees[t+1],s=a.within(i.x,i.y,n),l=i.numPoints||1,u=i.x*l,h=i.y*l,c=null;this.options.reduce&&(c=this.options.initial(),this._accumulate(c,i));for(var f=(o<<5)+(t+1),p=0;p<s.length;p++){var d=a.points[s[p]];if(!(d.zoom<=t)){d.zoom=t;var g=d.numPoints||1;u+=d.x*g,h+=d.y*g,l+=g,d.parentId=f,this.options.reduce&&this._accumulate(c,d);}}1===l?r.push(i):(i.parentId=f,r.push(we(u/l,h/l,f,l,c)));}}return r},_accumulate:function(e,t){var r=t.numPoints?t.properties:this.options.map(this.points[t.index].properties);this.options.reduce(e,r);}},Qe.prototype.options={maxZoom:14,indexMaxZoom:5,indexMaxPoints:1e5,tolerance:3,extent:4096,buffer:64,lineMetrics:!1,promoteId:null,generateId:!1,debug:0},Qe.prototype.splitTile=function(e,t,r,n,o,i,a){for(var s=[e,t,r,n],l=this.options,u=l.debug;s.length;){n=s.pop(),r=s.pop(),t=s.pop(),e=s.pop();var h=1<<t,c=$e(t,r,n),f=this.tiles[c];if(!f&&(u>1&&console.time("creation"),f=this.tiles[c]=Ke(e,t,r,n,l),this.tileCoords.push({z:t,x:r,y:n}),u)){u>1&&(console.log("tile z%d-%d-%d (features: %d, points: %d, simplified: %d)",t,r,n,f.numFeatures,f.numPoints,f.numSimplified),console.timeEnd("creation"));var p="z"+t;this.stats[p]=(this.stats[p]||0)+1,this.total++;}if(f.source=e,o){if(t===l.maxZoom||t===o)continue;var d=1<<o-t;if(r!==Math.floor(i/d)||n!==Math.floor(a/d))continue}else if(t===l.indexMaxZoom||f.numPoints<=l.indexMaxPoints)continue;if(f.source=null,0!==e.length){u>1&&console.time("clipping");var g,m,v,y,x,w,M=.5*l.buffer/l.extent,S=.5-M,_=.5+M,P=1+M;g=m=v=y=null,x=Re(e,h,r-M,r+_,0,f.minX,f.maxX,l),w=Re(e,h,r+S,r+P,0,f.minX,f.maxX,l),e=null,x&&(g=Re(x,h,n-M,n+_,1,f.minY,f.maxY,l),m=Re(x,h,n+S,n+P,1,f.minY,f.maxY,l),x=null),w&&(v=Re(w,h,n-M,n+_,1,f.minY,f.maxY,l),y=Re(w,h,n+S,n+P,1,f.minY,f.maxY,l),w=null),u>1&&console.timeEnd("clipping"),s.push(g||[],t+1,2*r,2*n),s.push(m||[],t+1,2*r,2*n+1),s.push(v||[],t+1,2*r+1,2*n),s.push(y||[],t+1,2*r+1,2*n+1);}}},Qe.prototype.getTile=function(e,t,r){var n=this.options,o=n.extent,i=n.debug;if(e<0||e>24)return null;var a=1<<e,s=$e(e,t=(t%a+a)%a,r);if(this.tiles[s])return Ye(this.tiles[s],o);i>1&&console.log("drilling down to z%d-%d-%d",e,t,r);for(var l,u=e,h=t,c=r;!l&&u>0;)u--,h=Math.floor(h/2),c=Math.floor(c/2),l=this.tiles[$e(u,h,c)];return l&&l.source?(i>1&&console.log("found parent tile z%d-%d-%d",u,h,c),i>1&&console.time("drilling down"),this.splitTile(l.source,u,h,c,e,t,r),i>1&&console.timeEnd("drilling down"),this.tiles[s]?Ye(this.tiles[s],o):null):null};var tt=function(t){function r(e,r,n){t.call(this,e,r,et),n&&(this.loadGeoJSON=n);}return t&&(r.__proto__=t),r.prototype=Object.create(t&&t.prototype),r.prototype.constructor=r,r.prototype.loadData=function(e,t){this._pendingCallback&&this._pendingCallback(null,{abandoned:!0}),this._pendingCallback=t,this._pendingLoadDataParams=e,this._state&&"Idle"!==this._state?this._state="NeedsLoadData":(this._state="Coalescing",this._loadData());},r.prototype._loadData=function(){var e=this;if(this._pendingCallback&&this._pendingLoadDataParams){var t=this._pendingCallback,r=this._pendingLoadDataParams;delete this._pendingCallback,delete this._pendingLoadDataParams;var n=!!(r&&r.request&&r.request.collectResourceTiming)&&new L.Performance(r.request);this.loadGeoJSON(r,function(o,i){if(o||!i)return t(o);if("object"!=typeof i)return t(new Error("Input data is not a valid GeoJSON object."));G(i,!0);try{e._geoJSONIndex=r.cluster?(a=r.superclusterOptions,new xe(a)).load(i.features):function(e,t){return new Qe(e,t)}(i,r.geojsonVtOptions);}catch(o){return t(o)}e.loaded={};var a,s={};if(n){var l=n.finish();l&&(s.resourceTiming={},s.resourceTiming[r.source]=JSON.parse(JSON.stringify(l)));}t(null,s);});}},r.prototype.coalesce=function(){"Coalescing"===this._state?this._state="Idle":"NeedsLoadData"===this._state&&(this._state="Coalescing",this._loadData());},r.prototype.reloadTile=function(e,r){var n=this.loaded,o=e.uid;return n&&n[o]?t.prototype.reloadTile.call(this,e,r):this.loadTile(e,r)},r.prototype.loadGeoJSON=function(t,r){if(t.request)e.getJSON(t.request,r);else{if("string"!=typeof t.data)return r(new Error("Input data is not a valid GeoJSON object."));try{return r(null,JSON.parse(t.data))}catch(e){return r(new Error("Input data is not a valid GeoJSON object."))}}},r.prototype.removeSource=function(e,t){this._pendingCallback&&this._pendingCallback(null,{abandoned:!0}),t();},r.prototype.getClusterExpansionZoom=function(e,t){t(null,this._geoJSONIndex.getClusterExpansionZoom(e.clusterId));},r.prototype.getClusterChildren=function(e,t){t(null,this._geoJSONIndex.getChildren(e.clusterId));},r.prototype.getClusterLeaves=function(e,t){t(null,this._geoJSONIndex.getLeaves(e.clusterId,e.limit,e.offset));},r}(O),rt=function(t){var r=this;this.self=t,this.actor=new e.Actor(t,this),this.layerIndexes={},this.workerSourceTypes={vector:O,geojson:tt},this.workerSources={},this.demWorkerSources={},this.self.registerWorkerSource=function(e,t){if(r.workerSourceTypes[e])throw new Error('Worker source with name "'+e+'" already registered.');r.workerSourceTypes[e]=t;},this.self.registerRTLTextPlugin=function(t){if(e.plugin.isLoaded())throw new Error("RTL text plugin already registered.");e.plugin.applyArabicShaping=t.applyArabicShaping,e.plugin.processBidirectionalText=t.processBidirectionalText,e.plugin.processStyledBidirectionalText=t.processStyledBidirectionalText;};};return rt.prototype.setLayers=function(e,t,r){this.getLayerIndex(e).replace(t),r();},rt.prototype.updateLayers=function(e,t,r){this.getLayerIndex(e).update(t.layers,t.removedIds),r();},rt.prototype.loadTile=function(e,t,r){this.getWorkerSource(e,t.type,t.source).loadTile(t,r);},rt.prototype.loadDEMTile=function(e,t,r){this.getDEMWorkerSource(e,t.source).loadTile(t,r);},rt.prototype.reloadTile=function(e,t,r){this.getWorkerSource(e,t.type,t.source).reloadTile(t,r);},rt.prototype.abortTile=function(e,t,r){this.getWorkerSource(e,t.type,t.source).abortTile(t,r);},rt.prototype.removeTile=function(e,t,r){this.getWorkerSource(e,t.type,t.source).removeTile(t,r);},rt.prototype.removeDEMTile=function(e,t){this.getDEMWorkerSource(e,t.source).removeTile(t);},rt.prototype.removeSource=function(e,t,r){if(this.workerSources[e]&&this.workerSources[e][t.type]&&this.workerSources[e][t.type][t.source]){var n=this.workerSources[e][t.type][t.source];delete this.workerSources[e][t.type][t.source],void 0!==n.removeSource?n.removeSource(t,r):r();}},rt.prototype.loadWorkerSource=function(e,t,r){try{this.self.importScripts(t.url),r();}catch(e){r(e.toString());}},rt.prototype.loadRTLTextPlugin=function(t,r,n){try{e.plugin.isLoaded()||(this.self.importScripts(r),n(e.plugin.isLoaded()?null:new Error("RTL Text Plugin failed to import scripts from "+r)));}catch(e){n(e.toString());}},rt.prototype.getLayerIndex=function(e){var t=this.layerIndexes[e];return t||(t=this.layerIndexes[e]=new n),t},rt.prototype.getWorkerSource=function(e,t,r){var n=this;if(this.workerSources[e]||(this.workerSources[e]={}),this.workerSources[e][t]||(this.workerSources[e][t]={}),!this.workerSources[e][t][r]){var o={send:function(t,r,o){n.actor.send(t,r,o,e);}};this.workerSources[e][t][r]=new this.workerSourceTypes[t](o,this.getLayerIndex(e));}return this.workerSources[e][t][r]},rt.prototype.getDEMWorkerSource=function(e,t){return this.demWorkerSources[e]||(this.demWorkerSources[e]={}),this.demWorkerSources[e][t]||(this.demWorkerSources[e][t]=new N),this.demWorkerSources[e][t]},"undefined"!=typeof WorkerGlobalScope&&"undefined"!=typeof self&&self instanceof WorkerGlobalScope&&new rt(self),rt});

define(["./shared.js"],function(t){"use strict";var e=t.createCommonjsModule(function(t){function e(t){return !!("undefined"!=typeof window&&"undefined"!=typeof document&&Array.prototype&&Array.prototype.every&&Array.prototype.filter&&Array.prototype.forEach&&Array.prototype.indexOf&&Array.prototype.lastIndexOf&&Array.prototype.map&&Array.prototype.some&&Array.prototype.reduce&&Array.prototype.reduceRight&&Array.isArray&&Function.prototype&&Function.prototype.bind&&Object.keys&&Object.create&&Object.getPrototypeOf&&Object.getOwnPropertyNames&&Object.isSealed&&Object.isFrozen&&Object.isExtensible&&Object.getOwnPropertyDescriptor&&Object.defineProperty&&Object.defineProperties&&Object.seal&&Object.freeze&&Object.preventExtensions&&"JSON"in window&&"parse"in JSON&&"stringify"in JSON&&function(){if(!("Worker"in window&&"Blob"in window&&"URL"in window))return !1;var t,e,i=new Blob([""],{type:"text/javascript"}),n=URL.createObjectURL(i);try{e=new Worker(n),t=!0;}catch(e){t=!1;}e&&e.terminate();return URL.revokeObjectURL(n),t}()&&"Uint8ClampedArray"in window&&ArrayBuffer.isView&&function(t){void 0===i[t]&&(i[t]=function(t){var i=document.createElement("canvas"),n=Object.create(e.webGLContextAttributes);return n.failIfMajorPerformanceCaveat=t,i.probablySupportsContext?i.probablySupportsContext("webgl",n)||i.probablySupportsContext("experimental-webgl",n):i.supportsContext?i.supportsContext("webgl",n)||i.supportsContext("experimental-webgl",n):i.getContext("webgl",n)||i.getContext("experimental-webgl",n)}(t));return i[t]}(t&&t.failIfMajorPerformanceCaveat))}t.exports?t.exports=e:window&&(window.mapboxgl=window.mapboxgl||{},window.mapboxgl.supported=e);var i={};e.webGLContextAttributes={antialias:!1,alpha:!0,stencil:!0,depth:!0};}),i={create:function(e,i,n){var o=t.window.document.createElement(e);return i&&(o.className=i),n&&n.appendChild(o),o},createNS:function(e,i){return t.window.document.createElementNS(e,i)}},n=t.window.document?t.window.document.documentElement.style:null;function o(t){if(!n)return null;for(var e=0;e<t.length;e++)if(t[e]in n)return t[e];return t[0]}var r,a=o(["userSelect","MozUserSelect","WebkitUserSelect","msUserSelect"]);i.disableDrag=function(){n&&a&&(r=n[a],n[a]="none");},i.enableDrag=function(){n&&a&&(n[a]=r);};var s=o(["transform","WebkitTransform"]);i.setTransform=function(t,e){t.style[s]=e;};var l=!1;try{var c=Object.defineProperty({},"passive",{get:function(){l=!0;}});t.window.addEventListener("test",c,c),t.window.removeEventListener("test",c,c);}catch(t){l=!1;}i.addEventListener=function(t,e,i,n){void 0===n&&(n={}),"passive"in n&&l?t.addEventListener(e,i,n):t.addEventListener(e,i,n.capture);},i.removeEventListener=function(t,e,i,n){void 0===n&&(n={}),"passive"in n&&l?t.removeEventListener(e,i,n):t.removeEventListener(e,i,n.capture);};var h=function(e){e.preventDefault(),e.stopPropagation(),t.window.removeEventListener("click",h,!0);};i.suppressClick=function(){t.window.addEventListener("click",h,!0),t.window.setTimeout(function(){t.window.removeEventListener("click",h,!0);},0);},i.mousePos=function(e,i){var n=e.getBoundingClientRect();return i=i.touches?i.touches[0]:i,new t.Point(i.clientX-n.left-e.clientLeft,i.clientY-n.top-e.clientTop)},i.touchPos=function(e,i){for(var n=e.getBoundingClientRect(),o=[],r="touchend"===i.type?i.changedTouches:i.touches,a=0;a<r.length;a++)o.push(new t.Point(r[a].clientX-n.left-e.clientLeft,r[a].clientY-n.top-e.clientTop));return o},i.mouseButton=function(e){return void 0!==t.window.InstallTrigger&&2===e.button&&e.ctrlKey&&t.window.navigator.platform.toUpperCase().indexOf("MAC")>=0?0:e.button},i.remove=function(t){t.parentNode&&t.parentNode.removeChild(t);};var u={API_URL:"https://api.mapbox.com",get EVENTS_URL(){return 0===this.API_URL.indexOf("https://api.mapbox.cn")?"https://events.mapbox.cn/events/v2":"https://events.mapbox.com/events/v2"},REQUIRE_ACCESS_TOKEN:!0,ACCESS_TOKEN:null},p="See https://www.mapbox.com/api-documentation/#access-tokens";function d(t,e){var i=b(u.API_URL);if(t.protocol=i.protocol,t.authority=i.authority,"/"!==i.path&&(t.path=""+i.path+t.path),!u.REQUIRE_ACCESS_TOKEN)return w(t);if(!(e=e||u.ACCESS_TOKEN))throw new Error("An API access token is required to use Mapbox GL. "+p);if("s"===e[0])throw new Error("Use a public access token (pk.*) with Mapbox GL, not a secret access token (sk.*). "+p);return t.params.push("access_token="+e),w(t)}function _(t){return 0===t.indexOf("mapbox:")}var f=function(t,e){if(!_(t))return t;var i=b(t);return i.path="/fonts/v1"+i.path,d(i,e)},m=function(t,e){if(!_(t))return t;var i=b(t);return i.path="/v4/"+i.authority+".json",i.params.push("secure"),d(i,e)},g=function(t,e,i,n){var o=b(t);return _(t)?(o.path="/styles/v1"+o.path+"/sprite"+e+i,d(o,n)):(o.path+=""+e+i,w(o))},v=/(\.(png|jpg)\d*)(?=$)/,y=function(e,i,n){if(!i||!_(i))return e;var o=b(e),r=t.browser.devicePixelRatio>=2||512===n?"@2x":"",a=t.browser.supportsWebp?".webp":"$1";return o.path=o.path.replace(v,""+r+a),function(t){for(var e=0;e<t.length;e++)0===t[e].indexOf("access_token=tk.")&&(t[e]="access_token="+(u.ACCESS_TOKEN||""));}(o.params),w(o)};var x=/^(\w+):\/\/([^/?]*)(\/[^?]+)?\??(.+)?/;function b(t){var e=t.match(x);if(!e)throw new Error("Unable to parse URL object");return {protocol:e[1],authority:e[2],path:e[3]||"/",params:e[4]?e[4].split("&"):[]}}function w(t){var e=t.params.length?"?"+t.params.join("&"):"";return t.protocol+"://"+t.authority+t.path+e}var E=function(){this.eventData={anonId:null,lastSuccess:null,accessToken:u.ACCESS_TOKEN},this.queue=[],this.pending=!1,this.pendingRequest=null;};E.prototype.postTurnstileEvent=function(e){u.ACCESS_TOKEN&&Array.isArray(e)&&e.some(function(t){return /(mapbox\.c)(n|om)/i.test(t)})&&this.queueRequest(t.browser.now());},E.prototype.queueRequest=function(t){this.queue.push(t),this.processRequests();},E.prototype.processRequests=function(){var e=this;if(!this.pendingRequest&&0!==this.queue.length){var i="mapbox.turnstileEventData:"+(u.ACCESS_TOKEN||""),n=t.storageAvailable("localStorage"),o=!!this.eventData.accessToken&&this.eventData.accessToken!==u.ACCESS_TOKEN;if(o&&(this.eventData.anonId=this.eventData.lastSuccess=null),(!this.eventData.anonId||!this.eventData.lastSuccess)&&n)try{var r=t.window.localStorage.getItem(i);r&&(this.eventData=JSON.parse(r));}catch(e){t.warnOnce("Unable to read from LocalStorage");}t.validateUuid(this.eventData.anonId)||(this.eventData.anonId=t.uuid(),o=!0);var a=this.queue.shift();if(this.eventData.lastSuccess){var s=new Date(this.eventData.lastSuccess),l=new Date(a),c=(a-this.eventData.lastSuccess)/864e5;o=o||c>=1||c<-1||s.getDate()!==l.getDate();}if(!o)return this.processRequests();var h=b(u.EVENTS_URL);h.params.push("access_token="+(u.ACCESS_TOKEN||""));var p={url:w(h),headers:{"Content-Type":"text/plain"}},d=JSON.stringify([{event:"appUserTurnstile",created:new Date(a).toISOString(),sdkIdentifier:"mapbox-gl-js",sdkVersion:"0.49.0","enabled.telemetry":!1,userId:this.eventData.anonId}]);this.pendingRequest=t.postData(p,d,function(o){if(e.pendingRequest=null,!o){if(e.eventData.lastSuccess=a,e.eventData.accessToken=u.ACCESS_TOKEN,n)try{t.window.localStorage.setItem(i,JSON.stringify(e.eventData));}catch(e){t.warnOnce("Unable to write to LocalStorage");}e.processRequests();}});}};var T=new E,S=T.postTurnstileEvent.bind(T);var I=function(){this.images={},this.loaded=!1,this.requestors=[],this.patterns={},this.atlasImage=new t.RGBAImage({width:1,height:1}),this.dirty=!0;};I.prototype.isLoaded=function(){return this.loaded},I.prototype.setLoaded=function(t){if(this.loaded!==t&&(this.loaded=t,t)){for(var e=0,i=this.requestors;e<i.length;e+=1){var n=i[e],o=n.ids,r=n.callback;this._notify(o,r);}this.requestors=[];}},I.prototype.getImage=function(t){return this.images[t]},I.prototype.addImage=function(t,e){this.images[t]=e;},I.prototype.removeImage=function(t){delete this.images[t],delete this.patterns[t];},I.prototype.listImages=function(){return Object.keys(this.images)},I.prototype.getImages=function(t,e){var i=!0;if(!this.isLoaded())for(var n=0,o=t;n<o.length;n+=1){var r=o[n];this.images[r]||(i=!1);}this.isLoaded()||i?this._notify(t,e):this.requestors.push({ids:t,callback:e});},I.prototype._notify=function(t,e){for(var i={},n=0,o=t;n<o.length;n+=1){var r=o[n],a=this.images[r];a&&(i[r]={data:a.data.clone(),pixelRatio:a.pixelRatio,sdf:a.sdf});}e(null,i);},I.prototype.getPixelSize=function(){var t=this.atlasImage;return {width:t.width,height:t.height}},I.prototype.getPattern=function(e){var i=this.patterns[e];if(i)return i.position;var n=this.getImage(e);if(!n)return null;var o={w:n.data.width+2,h:n.data.height+2,x:0,y:0},r=new t.ImagePosition(o,n);return this.patterns[e]={bin:o,position:r},this._updatePatternAtlas(),r},I.prototype.bind=function(e){var i=e.gl;this.atlasTexture?this.dirty&&(this.atlasTexture.update(this.atlasImage),this.dirty=!1):this.atlasTexture=new t.Texture(e,this.atlasImage,i.RGBA),this.atlasTexture.bind(i.LINEAR,i.CLAMP_TO_EDGE);},I.prototype._updatePatternAtlas=function(){var e=[];for(var i in this.patterns)e.push(this.patterns[i].bin);var n=t.potpack(e),o=n.w,r=n.h,a=this.atlasImage;for(var s in a.resize({width:o||1,height:r||1}),this.patterns){var l=this.patterns[s].bin,c=l.x+1,h=l.y+1,u=this.images[s].data,p=u.width,d=u.height;t.RGBAImage.copy(u,a,{x:0,y:0},{x:c,y:h},{width:p,height:d}),t.RGBAImage.copy(u,a,{x:0,y:d-1},{x:c,y:h-1},{width:p,height:1}),t.RGBAImage.copy(u,a,{x:0,y:0},{x:c,y:h+d},{width:p,height:1}),t.RGBAImage.copy(u,a,{x:p-1,y:0},{x:c-1,y:h},{width:1,height:d}),t.RGBAImage.copy(u,a,{x:0,y:0},{x:c+p,y:h},{width:1,height:d});}this.dirty=!0;};var C=P,z=1e20;function P(t,e,i,n,o,r){this.fontSize=t||24,this.buffer=void 0===e?3:e,this.cutoff=n||.25,this.fontFamily=o||"sans-serif",this.fontWeight=r||"normal",this.radius=i||8;var a=this.size=this.fontSize+2*this.buffer;this.canvas=document.createElement("canvas"),this.canvas.width=this.canvas.height=a,this.ctx=this.canvas.getContext("2d"),this.ctx.font=this.fontWeight+" "+this.fontSize+"px "+this.fontFamily,this.ctx.textBaseline="middle",this.ctx.fillStyle="black",this.gridOuter=new Float64Array(a*a),this.gridInner=new Float64Array(a*a),this.f=new Float64Array(a),this.d=new Float64Array(a),this.z=new Float64Array(a+1),this.v=new Int16Array(a),this.middle=Math.round(a/2*(navigator.userAgent.indexOf("Gecko/")>=0?1.2:1));}function R(t,e,i,n,o,r,a){for(var s=0;s<e;s++){for(var l=0;l<i;l++)n[l]=t[l*e+s];for(A(n,o,r,a,i),l=0;l<i;l++)t[l*e+s]=o[l];}for(l=0;l<i;l++){for(s=0;s<e;s++)n[s]=t[l*e+s];for(A(n,o,r,a,e),s=0;s<e;s++)t[l*e+s]=Math.sqrt(o[s]);}}function A(t,e,i,n,o){i[0]=0,n[0]=-z,n[1]=+z;for(var r=1,a=0;r<o;r++){for(var s=(t[r]+r*r-(t[i[a]]+i[a]*i[a]))/(2*r-2*i[a]);s<=n[a];)a--,s=(t[r]+r*r-(t[i[a]]+i[a]*i[a]))/(2*r-2*i[a]);i[++a]=r,n[a]=s,n[a+1]=+z;}for(r=0,a=0;r<o;r++){for(;n[a+1]<r;)a++;e[r]=(r-i[a])*(r-i[a])+t[i[a]];}}P.prototype.draw=function(t){this.ctx.clearRect(0,0,this.size,this.size),this.ctx.fillText(t,this.buffer,this.middle);for(var e=this.ctx.getImageData(0,0,this.size,this.size),i=new Uint8ClampedArray(this.size*this.size),n=0;n<this.size*this.size;n++){var o=e.data[4*n+3]/255;this.gridOuter[n]=1===o?0:0===o?z:Math.pow(Math.max(0,.5-o),2),this.gridInner[n]=1===o?z:0===o?0:Math.pow(Math.max(0,o-.5),2);}for(R(this.gridOuter,this.size,this.size,this.f,this.d,this.v,this.z),R(this.gridInner,this.size,this.size,this.f,this.d,this.v,this.z),n=0;n<this.size*this.size;n++){var r=this.gridOuter[n]-this.gridInner[n];i[n]=Math.max(0,Math.min(255,Math.round(255-255*(r/this.radius+this.cutoff))));}return i};var L=function(t,e){this.requestTransform=t,this.localIdeographFontFamily=e,this.entries={};};L.prototype.setURL=function(t){this.url=t;},L.prototype.getGlyphs=function(e,i){var n=this,o=[];for(var r in e)for(var a=0,s=e[r];a<s.length;a+=1){var l=s[a];o.push({stack:r,id:l});}t.asyncAll(o,function(t,e){var i=t.stack,o=t.id,r=n.entries[i];r||(r=n.entries[i]={glyphs:{},requests:{}});var a=r.glyphs[o];if(void 0===a)if(a=n._tinySDF(r,i,o))e(null,{stack:i,id:o,glyph:a});else{var s=Math.floor(o/256);if(256*s>65535)e(new Error("glyphs > 65535 not supported"));else{var l=r.requests[s];l||(l=r.requests[s]=[],L.loadGlyphRange(i,s,n.url,n.requestTransform,function(t,e){if(e)for(var i in e)r.glyphs[+i]=e[+i];for(var n=0,o=l;n<o.length;n+=1){(0,o[n])(t,e);}delete r.requests[s];})),l.push(function(t,n){t?e(t):n&&e(null,{stack:i,id:o,glyph:n[o]||null});});}}else e(null,{stack:i,id:o,glyph:a});},function(t,e){if(t)i(t);else if(e){for(var n={},o=0,r=e;o<r.length;o+=1){var a=r[o],s=a.stack,l=a.id,c=a.glyph;(n[s]||(n[s]={}))[l]=c&&{id:c.id,bitmap:c.bitmap.clone(),metrics:c.metrics};}i(null,n);}});},L.prototype._tinySDF=function(e,i,n){var o=this.localIdeographFontFamily;if(o&&(t.isChar["CJK Unified Ideographs"](n)||t.isChar["Hangul Syllables"](n))){var r=e.tinySDF;if(!r){var a="400";/bold/i.test(i)?a="900":/medium/i.test(i)?a="500":/light/i.test(i)&&(a="200"),r=e.tinySDF=new L.TinySDF(24,3,8,.25,o,a);}return {id:n,bitmap:new t.AlphaImage({width:30,height:30},r.draw(String.fromCharCode(n))),metrics:{width:24,height:24,left:0,top:-8,advance:24}}}},L.loadGlyphRange=function(e,i,n,o,r){var a=256*i,s=a+255,l=o(f(n).replace("{fontstack}",e).replace("{range}",a+"-"+s),t.ResourceType.Glyphs);t.getArrayBuffer(l,function(e,i){if(e)r(e);else if(i){for(var n={},o=0,a=t.parseGlyphPBF(i.data);o<a.length;o+=1){var s=a[o];n[s.id]=s;}r(null,n);}});},L.TinySDF=C;var D=function(){this.specification=t.styleSpec.light.position;};D.prototype.possiblyEvaluate=function(e,i){return t.sphericalToCartesian(e.expression.evaluate(i))},D.prototype.interpolate=function(e,i,n){return {x:t.number(e.x,i.x,n),y:t.number(e.y,i.y,n),z:t.number(e.z,i.z,n)}};var M=new t.Properties({anchor:new t.DataConstantProperty(t.styleSpec.light.anchor),position:new D,color:new t.DataConstantProperty(t.styleSpec.light.color),intensity:new t.DataConstantProperty(t.styleSpec.light.intensity)}),k=function(e){function i(i){e.call(this),this._transitionable=new t.Transitionable(M),this.setLight(i),this._transitioning=this._transitionable.untransitioned();}return e&&(i.__proto__=e),i.prototype=Object.create(e&&e.prototype),i.prototype.constructor=i,i.prototype.getLight=function(){return this._transitionable.serialize()},i.prototype.setLight=function(e){if(!this._validate(t.validateLight,e))for(var i in e){var n=e[i];t.endsWith(i,"-transition")?this._transitionable.setTransition(i.slice(0,-"-transition".length),n):this._transitionable.setValue(i,n);}},i.prototype.updateTransitions=function(t){this._transitioning=this._transitionable.transitioned(t,this._transitioning);},i.prototype.hasTransition=function(){return this._transitioning.hasTransition()},i.prototype.recalculate=function(t){this.properties=this._transitioning.possiblyEvaluate(t);},i.prototype._validate=function(e,i){return t.emitValidationErrors(this,e.call(t.validateStyle,t.extend({value:i,style:{glyphs:!0,sprite:!0},styleSpec:t.styleSpec})))},i}(t.Evented),B=function(t,e){this.width=t,this.height=e,this.nextRow=0,this.bytes=4,this.data=new Uint8Array(this.width*this.height*this.bytes),this.positions={};};B.prototype.getDash=function(t,e){var i=t.join(",")+String(e);return this.positions[i]||(this.positions[i]=this.addDash(t,e)),this.positions[i]},B.prototype.addDash=function(e,i){var n=i?7:0,o=2*n+1;if(this.nextRow+o>this.height)return t.warnOnce("LineAtlas out of space"),null;for(var r=0,a=0;a<e.length;a++)r+=e[a];for(var s=this.width/r,l=s/2,c=e.length%2==1,h=-n;h<=n;h++)for(var u=this.nextRow+n+h,p=this.width*u,d=c?-e[e.length-1]:0,_=e[0],f=1,m=0;m<this.width;m++){for(;_<m/s;)d=_,_+=e[f],c&&f===e.length-1&&(_+=e[0]),f++;var g=Math.abs(m-d*s),v=Math.abs(m-_*s),y=Math.min(g,v),x=f%2==1,b=void 0;if(i){var w=n?h/n*(l+1):0;if(x){var E=l-Math.abs(w);b=Math.sqrt(y*y+E*E);}else b=l-Math.sqrt(y*y+w*w);}else b=(x?1:-1)*y;this.data[3+4*(p+m)]=Math.max(0,Math.min(255,b+128));}var T={y:(this.nextRow+n+.5)/this.height,height:2*n/this.height,width:r};return this.nextRow+=o,this.dirty=!0,T},B.prototype.bind=function(t){var e=t.gl;this.texture?(e.bindTexture(e.TEXTURE_2D,this.texture),this.dirty&&(this.dirty=!1,e.texSubImage2D(e.TEXTURE_2D,0,0,0,this.width,this.height,e.RGBA,e.UNSIGNED_BYTE,this.data))):(this.texture=e.createTexture(),e.bindTexture(e.TEXTURE_2D,this.texture),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.REPEAT),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.REPEAT),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,this.width,this.height,0,e.RGBA,e.UNSIGNED_BYTE,this.data));};var O=function e(i,n){this.workerPool=i,this.actors=[],this.currentActor=0,this.id=t.uniqueId();for(var o=this.workerPool.acquire(this.id),r=0;r<o.length;r++){var a=o[r],s=new e.Actor(a,n,this.id);s.name="Worker "+r,this.actors.push(s);}};function F(e,i,n){var o=function(e,i){if(e)return n(e);if(i){var o=t.pick(i,["tiles","minzoom","maxzoom","attribution","mapbox_logo","bounds"]);i.vector_layers&&(o.vectorLayers=i.vector_layers,o.vectorLayerIds=o.vectorLayers.map(function(t){return t.id})),n(null,o);}};return e.url?t.getJSON(i(m(e.url),t.ResourceType.Source),o):t.browser.frame(function(){return o(null,e)})}O.prototype.broadcast=function(e,i,n){n=n||function(){},t.asyncAll(this.actors,function(t,n){t.send(e,i,n);},n);},O.prototype.send=function(t,e,i,n){return ("number"!=typeof n||isNaN(n))&&(n=this.currentActor=(this.currentActor+1)%this.actors.length),this.actors[n].send(t,e,i),n},O.prototype.remove=function(){this.actors.forEach(function(t){t.remove();}),this.actors=[],this.workerPool.release(this.id);},O.Actor=t.Actor;var U=function(t,e){if(isNaN(t)||isNaN(e))throw new Error("Invalid LngLat object: ("+t+", "+e+")");if(this.lng=+t,this.lat=+e,this.lat>90||this.lat<-90)throw new Error("Invalid LngLat latitude value: must be between -90 and 90")};U.prototype.wrap=function(){return new U(t.wrap(this.lng,-180,180),this.lat)},U.prototype.toArray=function(){return [this.lng,this.lat]},U.prototype.toString=function(){return "LngLat("+this.lng+", "+this.lat+")"},U.prototype.toBounds=function(t){var e=360*t/40075017,i=e/Math.cos(Math.PI/180*this.lat);return new N(new U(this.lng-i,this.lat-e),new U(this.lng+i,this.lat+e))},U.convert=function(t){if(t instanceof U)return t;if(Array.isArray(t)&&(2===t.length||3===t.length))return new U(Number(t[0]),Number(t[1]));if(!Array.isArray(t)&&"object"==typeof t&&null!==t)return new U(Number(t.lng),Number(t.lat));throw new Error("`LngLatLike` argument must be specified as a LngLat instance, an object {lng: <lng>, lat: <lat>}, or an array of [<lng>, <lat>]")};var N=function(t,e){t&&(e?this.setSouthWest(t).setNorthEast(e):4===t.length?this.setSouthWest([t[0],t[1]]).setNorthEast([t[2],t[3]]):this.setSouthWest(t[0]).setNorthEast(t[1]));};N.prototype.setNorthEast=function(t){return this._ne=t instanceof U?new U(t.lng,t.lat):U.convert(t),this},N.prototype.setSouthWest=function(t){return this._sw=t instanceof U?new U(t.lng,t.lat):U.convert(t),this},N.prototype.extend=function(t){var e,i,n=this._sw,o=this._ne;if(t instanceof U)e=t,i=t;else{if(!(t instanceof N))return Array.isArray(t)?t.every(Array.isArray)?this.extend(N.convert(t)):this.extend(U.convert(t)):this;if(e=t._sw,i=t._ne,!e||!i)return this}return n||o?(n.lng=Math.min(e.lng,n.lng),n.lat=Math.min(e.lat,n.lat),o.lng=Math.max(i.lng,o.lng),o.lat=Math.max(i.lat,o.lat)):(this._sw=new U(e.lng,e.lat),this._ne=new U(i.lng,i.lat)),this},N.prototype.getCenter=function(){return new U((this._sw.lng+this._ne.lng)/2,(this._sw.lat+this._ne.lat)/2)},N.prototype.getSouthWest=function(){return this._sw},N.prototype.getNorthEast=function(){return this._ne},N.prototype.getNorthWest=function(){return new U(this.getWest(),this.getNorth())},N.prototype.getSouthEast=function(){return new U(this.getEast(),this.getSouth())},N.prototype.getWest=function(){return this._sw.lng},N.prototype.getSouth=function(){return this._sw.lat},N.prototype.getEast=function(){return this._ne.lng},N.prototype.getNorth=function(){return this._ne.lat},N.prototype.toArray=function(){return [this._sw.toArray(),this._ne.toArray()]},N.prototype.toString=function(){return "LngLatBounds("+this._sw.toString()+", "+this._ne.toString()+")"},N.prototype.isEmpty=function(){return !(this._sw&&this._ne)},N.convert=function(t){return !t||t instanceof N?t:new N(t)};var Z=function(t,e,i){this.bounds=N.convert(this.validateBounds(t)),this.minzoom=e||0,this.maxzoom=i||24;};Z.prototype.validateBounds=function(t){return Array.isArray(t)&&4===t.length?[Math.max(-180,t[0]),Math.max(-90,t[1]),Math.min(180,t[2]),Math.min(90,t[3])]:[-180,-90,180,90]},Z.prototype.contains=function(t){var e=Math.floor(this.lngX(this.bounds.getWest(),t.z)),i=Math.floor(this.latY(this.bounds.getNorth(),t.z)),n=Math.ceil(this.lngX(this.bounds.getEast(),t.z)),o=Math.ceil(this.latY(this.bounds.getSouth(),t.z));return t.x>=e&&t.x<n&&t.y>=i&&t.y<o},Z.prototype.lngX=function(t,e){return (t+180)*(Math.pow(2,e)/360)},Z.prototype.latY=function(e,i){var n=t.clamp(Math.sin(Math.PI/180*e),-.9999,.9999),o=Math.pow(2,i)/(2*Math.PI);return Math.pow(2,i-1)+.5*Math.log((1+n)/(1-n))*-o};var q=function(e){function i(i,n,o,r){if(e.call(this),this.id=i,this.dispatcher=o,this.type="vector",this.minzoom=0,this.maxzoom=22,this.scheme="xyz",this.tileSize=512,this.reparseOverscaled=!0,this.isTileClipped=!0,t.extend(this,t.pick(n,["url","scheme","tileSize"])),this._options=t.extend({type:"vector"},n),this._collectResourceTiming=n.collectResourceTiming,512!==this.tileSize)throw new Error("vector tile sources must have a tileSize of 512");this.setEventedParent(r);}return e&&(i.__proto__=e),i.prototype=Object.create(e&&e.prototype),i.prototype.constructor=i,i.prototype.load=function(){var e=this;this.fire(new t.Event("dataloading",{dataType:"source"})),this._tileJSONRequest=F(this._options,this.map._transformRequest,function(i,n){e._tileJSONRequest=null,i?e.fire(new t.ErrorEvent(i)):n&&(t.extend(e,n),n.bounds&&(e.tileBounds=new Z(n.bounds,e.minzoom,e.maxzoom)),S(n.tiles),e.fire(new t.Event("data",{dataType:"source",sourceDataType:"metadata"})),e.fire(new t.Event("data",{dataType:"source",sourceDataType:"content"})));});},i.prototype.hasTile=function(t){return !this.tileBounds||this.tileBounds.contains(t.canonical)},i.prototype.onAdd=function(t){this.map=t,this.load();},i.prototype.onRemove=function(){this._tileJSONRequest&&(this._tileJSONRequest.cancel(),this._tileJSONRequest=null);},i.prototype.serialize=function(){return t.extend({},this._options)},i.prototype.loadTile=function(e,i){var n=y(e.tileID.canonical.url(this.tiles,this.scheme),this.url),o={request:this.map._transformRequest(n,t.ResourceType.Tile),uid:e.uid,tileID:e.tileID,zoom:e.tileID.overscaledZ,tileSize:this.tileSize*e.tileID.overscaleFactor(),type:this.type,source:this.id,pixelRatio:t.browser.devicePixelRatio,showCollisionBoxes:this.map.showCollisionBoxes};function r(t,n){return e.aborted?i(null):t&&404!==t.status?i(t):(n&&n.resourceTiming&&(e.resourceTiming=n.resourceTiming),this.map._refreshExpiredTiles&&n&&e.setExpiryData(n),e.loadVectorData(n,this.map.painter),i(null),void(e.reloadCallback&&(this.loadTile(e,e.reloadCallback),e.reloadCallback=null)))}o.request.collectResourceTiming=this._collectResourceTiming,void 0===e.workerID||"expired"===e.state?e.workerID=this.dispatcher.send("loadTile",o,r.bind(this)):"loading"===e.state?e.reloadCallback=i:this.dispatcher.send("reloadTile",o,r.bind(this),e.workerID);},i.prototype.abortTile=function(t){this.dispatcher.send("abortTile",{uid:t.uid,type:this.type,source:this.id},void 0,t.workerID);},i.prototype.unloadTile=function(t){t.unloadVectorData(),this.dispatcher.send("removeTile",{uid:t.uid,type:this.type,source:this.id},void 0,t.workerID);},i.prototype.hasTransition=function(){return !1},i}(t.Evented),V=function(e){function i(i,n,o,r){e.call(this),this.id=i,this.dispatcher=o,this.setEventedParent(r),this.type="raster",this.minzoom=0,this.maxzoom=22,this.roundZoom=!0,this.scheme="xyz",this.tileSize=512,this._loaded=!1,this._options=t.extend({},n),t.extend(this,t.pick(n,["url","scheme","tileSize"]));}return e&&(i.__proto__=e),i.prototype=Object.create(e&&e.prototype),i.prototype.constructor=i,i.prototype.load=function(){var e=this;this.fire(new t.Event("dataloading",{dataType:"source"})),this._tileJSONRequest=F(this._options,this.map._transformRequest,function(i,n){e._tileJSONRequest=null,i?e.fire(new t.ErrorEvent(i)):n&&(t.extend(e,n),n.bounds&&(e.tileBounds=new Z(n.bounds,e.minzoom,e.maxzoom)),S(n.tiles),e.fire(new t.Event("data",{dataType:"source",sourceDataType:"metadata"})),e.fire(new t.Event("data",{dataType:"source",sourceDataType:"content"})));});},i.prototype.onAdd=function(t){this.map=t,this.load();},i.prototype.onRemove=function(){this._tileJSONRequest&&(this._tileJSONRequest.cancel(),this._tileJSONRequest=null);},i.prototype.serialize=function(){return t.extend({},this._options)},i.prototype.hasTile=function(t){return !this.tileBounds||this.tileBounds.contains(t.canonical)},i.prototype.loadTile=function(e,i){var n=this,o=y(e.tileID.canonical.url(this.tiles,this.scheme),this.url,this.tileSize);e.request=t.getImage(this.map._transformRequest(o,t.ResourceType.Tile),function(o,r){if(delete e.request,e.aborted)e.state="unloaded",i(null);else if(o)e.state="errored",i(o);else if(r){n.map._refreshExpiredTiles&&e.setExpiryData(r),delete r.cacheControl,delete r.expires;var a=n.map.painter.context,s=a.gl;e.texture=n.map.painter.getTileTexture(r.width),e.texture?e.texture.update(r,{useMipmap:!0}):(e.texture=new t.Texture(a,r,s.RGBA,{useMipmap:!0}),e.texture.bind(s.LINEAR,s.CLAMP_TO_EDGE,s.LINEAR_MIPMAP_NEAREST),a.extTextureFilterAnisotropic&&s.texParameterf(s.TEXTURE_2D,a.extTextureFilterAnisotropic.TEXTURE_MAX_ANISOTROPY_EXT,a.extTextureFilterAnisotropicMax)),e.state="loaded",i(null);}});},i.prototype.abortTile=function(t,e){t.request&&(t.request.cancel(),delete t.request),e();},i.prototype.unloadTile=function(t,e){t.texture&&this.map.painter.saveTileTexture(t.texture),e();},i.prototype.hasTransition=function(){return !1},i}(t.Evented),j=function(e){function i(i,n,o,r){e.call(this,i,n,o,r),this.type="raster-dem",this.maxzoom=22,this._options=t.extend({},n),this.encoding=n.encoding||"mapbox";}return e&&(i.__proto__=e),i.prototype=Object.create(e&&e.prototype),i.prototype.constructor=i,i.prototype.serialize=function(){return {type:"raster-dem",url:this.url,tileSize:this.tileSize,tiles:this.tiles,bounds:this.bounds,encoding:this.encoding}},i.prototype.loadTile=function(e,i){var n=y(e.tileID.canonical.url(this.tiles,this.scheme),this.url,this.tileSize);e.request=t.getImage(this.map._transformRequest(n,t.ResourceType.Tile),function(n,o){if(delete e.request,e.aborted)e.state="unloaded",i(null);else if(n)e.state="errored",i(n);else if(o){this.map._refreshExpiredTiles&&e.setExpiryData(o),delete o.cacheControl,delete o.expires;var r=t.browser.getImageData(o),a={uid:e.uid,coord:e.tileID,source:this.id,rawImageData:r,encoding:this.encoding};e.workerID&&"expired"!==e.state||(e.workerID=this.dispatcher.send("loadDEMTile",a,function(t,n){t&&(e.state="errored",i(t));n&&(e.dem=n,e.needsHillshadePrepare=!0,e.state="loaded",i(null));}.bind(this)));}}.bind(this)),e.neighboringTiles=this._getNeighboringTiles(e.tileID);},i.prototype._getNeighboringTiles=function(e){var i=e.canonical,n=Math.pow(2,i.z),o=(i.x-1+n)%n,r=0===i.x?e.wrap-1:e.wrap,a=(i.x+1+n)%n,s=i.x+1===n?e.wrap+1:e.wrap,l={};return l[new t.OverscaledTileID(e.overscaledZ,r,i.z,o,i.y).key]={backfilled:!1},l[new t.OverscaledTileID(e.overscaledZ,s,i.z,a,i.y).key]={backfilled:!1},i.y>0&&(l[new t.OverscaledTileID(e.overscaledZ,r,i.z,o,i.y-1).key]={backfilled:!1},l[new t.OverscaledTileID(e.overscaledZ,e.wrap,i.z,i.x,i.y-1).key]={backfilled:!1},l[new t.OverscaledTileID(e.overscaledZ,s,i.z,a,i.y-1).key]={backfilled:!1}),i.y+1<n&&(l[new t.OverscaledTileID(e.overscaledZ,r,i.z,o,i.y+1).key]={backfilled:!1},l[new t.OverscaledTileID(e.overscaledZ,e.wrap,i.z,i.x,i.y+1).key]={backfilled:!1},l[new t.OverscaledTileID(e.overscaledZ,s,i.z,a,i.y+1).key]={backfilled:!1}),l},i.prototype.unloadTile=function(t){t.demTexture&&this.map.painter.saveTileTexture(t.demTexture),t.fbo&&(t.fbo.destroy(),delete t.fbo),t.dem&&delete t.dem,delete t.neighboringTiles,t.state="unloaded",this.dispatcher.send("removeDEMTile",{uid:t.uid,source:this.id},void 0,t.workerID);},i}(V),G=function(e){function i(i,n,o,r){e.call(this),this.id=i,this.type="geojson",this.minzoom=0,this.maxzoom=18,this.tileSize=512,this.isTileClipped=!0,this.reparseOverscaled=!0,this._removed=!1,this.dispatcher=o,this.setEventedParent(r),this._data=n.data,this._options=t.extend({},n),this._collectResourceTiming=n.collectResourceTiming,this._resourceTiming=[],void 0!==n.maxzoom&&(this.maxzoom=n.maxzoom),n.type&&(this.type=n.type),n.attribution&&(this.attribution=n.attribution);var a=t.EXTENT/this.tileSize;this.workerOptions=t.extend({source:this.id,cluster:n.cluster||!1,geojsonVtOptions:{buffer:(void 0!==n.buffer?n.buffer:128)*a,tolerance:(void 0!==n.tolerance?n.tolerance:.375)*a,extent:t.EXTENT,maxZoom:this.maxzoom,lineMetrics:n.lineMetrics||!1,generateId:n.generateId||!1},superclusterOptions:{maxZoom:void 0!==n.clusterMaxZoom?Math.min(n.clusterMaxZoom,this.maxzoom-1):this.maxzoom-1,extent:t.EXTENT,radius:(n.clusterRadius||50)*a,log:!1}},n.workerOptions);}return e&&(i.__proto__=e),i.prototype=Object.create(e&&e.prototype),i.prototype.constructor=i,i.prototype.load=function(){var e=this;this.fire(new t.Event("dataloading",{dataType:"source"})),this._updateWorkerData(function(i){if(i)e.fire(new t.ErrorEvent(i));else{var n={dataType:"source",sourceDataType:"metadata"};e._collectResourceTiming&&e._resourceTiming&&e._resourceTiming.length>0&&(n.resourceTiming=e._resourceTiming,e._resourceTiming=[]),e.fire(new t.Event("data",n));}});},i.prototype.onAdd=function(t){this.map=t,this.load();},i.prototype.setData=function(e){var i=this;return this._data=e,this.fire(new t.Event("dataloading",{dataType:"source"})),this._updateWorkerData(function(e){if(e)i.fire(new t.ErrorEvent(e));else{var n={dataType:"source",sourceDataType:"content"};i._collectResourceTiming&&i._resourceTiming&&i._resourceTiming.length>0&&(n.resourceTiming=i._resourceTiming,i._resourceTiming=[]),i.fire(new t.Event("data",n));}}),this},i.prototype.getClusterExpansionZoom=function(t,e){return this.dispatcher.send("geojson.getClusterExpansionZoom",{clusterId:t,source:this.id},e,this.workerID),this},i.prototype.getClusterChildren=function(t,e){return this.dispatcher.send("geojson.getClusterChildren",{clusterId:t,source:this.id},e,this.workerID),this},i.prototype.getClusterLeaves=function(t,e,i,n){return this.dispatcher.send("geojson.getClusterLeaves",{source:this.id,clusterId:t,limit:e,offset:i},n,this.workerID),this},i.prototype._updateWorkerData=function(e){var i=this,n=t.extend({},this.workerOptions),o=this._data;"string"==typeof o?(n.request=this.map._transformRequest(t.browser.resolveURL(o),t.ResourceType.Source),n.request.collectResourceTiming=this._collectResourceTiming):n.data=JSON.stringify(o),this.workerID=this.dispatcher.send(this.type+".loadData",n,function(t,o){i._removed||o&&o.abandoned||(i._loaded=!0,o&&o.resourceTiming&&o.resourceTiming[i.id]&&(i._resourceTiming=o.resourceTiming[i.id].slice(0)),i.dispatcher.send(i.type+".coalesce",{source:n.source},null,i.workerID),e(t));},this.workerID);},i.prototype.loadTile=function(e,i){var n=this,o=void 0===e.workerID?"loadTile":"reloadTile",r={type:this.type,uid:e.uid,tileID:e.tileID,zoom:e.tileID.overscaledZ,maxZoom:this.maxzoom,tileSize:this.tileSize,source:this.id,pixelRatio:t.browser.devicePixelRatio,showCollisionBoxes:this.map.showCollisionBoxes};e.workerID=this.dispatcher.send(o,r,function(t,r){return e.unloadVectorData(),e.aborted?i(null):t?i(t):(e.loadVectorData(r,n.map.painter,"reloadTile"===o),i(null))},this.workerID);},i.prototype.abortTile=function(t){t.aborted=!0;},i.prototype.unloadTile=function(t){t.unloadVectorData(),this.dispatcher.send("removeTile",{uid:t.uid,type:this.type,source:this.id},null,t.workerID);},i.prototype.onRemove=function(){this._removed=!0,this.dispatcher.send("removeSource",{type:this.type,source:this.id},null,this.workerID);},i.prototype.serialize=function(){return t.extend({},this._options,{type:this.type,data:this._data})},i.prototype.hasTransition=function(){return !1},i}(t.Evented),W=function(e){function i(t,i,n,o){e.call(this),this.id=t,this.dispatcher=n,this.coordinates=i.coordinates,this.type="image",this.minzoom=0,this.maxzoom=22,this.tileSize=512,this.tiles={},this.setEventedParent(o),this.options=i;}return e&&(i.__proto__=e),i.prototype=Object.create(e&&e.prototype),i.prototype.constructor=i,i.prototype.load=function(){var e=this;this.fire(new t.Event("dataloading",{dataType:"source"})),this.url=this.options.url,t.getImage(this.map._transformRequest(this.url,t.ResourceType.Image),function(i,n){i?e.fire(new t.ErrorEvent(i)):n&&(e.image=t.browser.getImageData(n),e._finishLoading());});},i.prototype._finishLoading=function(){this.map&&(this.setCoordinates(this.coordinates),this.fire(new t.Event("data",{dataType:"source",sourceDataType:"metadata"})));},i.prototype.onAdd=function(t){this.map=t,this.load();},i.prototype.setCoordinates=function(e){this.coordinates=e;var i=this.map,n=e.map(function(t){return i.transform.locationCoordinate(U.convert(t)).zoomTo(0)}),o=this.centerCoord=t.getCoordinatesCenter(n);o.column=Math.floor(o.column),o.row=Math.floor(o.row),this.tileID=new t.CanonicalTileID(o.zoom,o.column,o.row),this.minzoom=this.maxzoom=o.zoom;var r=n.map(function(e){var i=e.zoomTo(o.zoom);return new t.Point(Math.round((i.column-o.column)*t.EXTENT),Math.round((i.row-o.row)*t.EXTENT))});return this._boundsArray=new t.StructArrayLayout4i8,this._boundsArray.emplaceBack(r[0].x,r[0].y,0,0),this._boundsArray.emplaceBack(r[1].x,r[1].y,t.EXTENT,0),this._boundsArray.emplaceBack(r[3].x,r[3].y,0,t.EXTENT),this._boundsArray.emplaceBack(r[2].x,r[2].y,t.EXTENT,t.EXTENT),this.boundsBuffer&&(this.boundsBuffer.destroy(),delete this.boundsBuffer),this.fire(new t.Event("data",{dataType:"source",sourceDataType:"content"})),this},i.prototype.prepare=function(){if(0!==Object.keys(this.tiles).length&&this.image){var e=this.map.painter.context,i=e.gl;for(var n in this.boundsBuffer||(this.boundsBuffer=e.createVertexBuffer(this._boundsArray,t.rasterBoundsAttributes.members)),this.boundsSegments||(this.boundsSegments=t.SegmentVector.simpleSegment(0,0,4,2)),this.texture||(this.texture=new t.Texture(e,this.image,i.RGBA),this.texture.bind(i.LINEAR,i.CLAMP_TO_EDGE)),this.tiles){var o=this.tiles[n];"loaded"!==o.state&&(o.state="loaded",o.texture=this.texture);}}},i.prototype.loadTile=function(t,e){this.tileID&&this.tileID.equals(t.tileID.canonical)?(this.tiles[String(t.tileID.wrap)]=t,t.buckets={},e(null)):(t.state="errored",e(null));},i.prototype.serialize=function(){return {type:"image",url:this.options.url,coordinates:this.coordinates}},i.prototype.hasTransition=function(){return !1},i}(t.Evented),X=function(e){function i(t,i,n,o){e.call(this,t,i,n,o),this.roundZoom=!0,this.type="video",this.options=i;}return e&&(i.__proto__=e),i.prototype=Object.create(e&&e.prototype),i.prototype.constructor=i,i.prototype.load=function(){var e=this,i=this.options;this.urls=[];for(var n=0,o=i.urls;n<o.length;n+=1){var r=o[n];e.urls.push(e.map._transformRequest(r,t.ResourceType.Source).url);}t.getVideo(this.urls,function(i,n){i?e.fire(new t.ErrorEvent(i)):n&&(e.video=n,e.video.loop=!0,e.video.addEventListener("playing",function(){e.map._rerender();}),e.map&&e.video.play(),e._finishLoading());});},i.prototype.getVideo=function(){return this.video},i.prototype.onAdd=function(t){this.map||(this.map=t,this.load(),this.video&&(this.video.play(),this.setCoordinates(this.coordinates)));},i.prototype.prepare=function(){if(!(0===Object.keys(this.tiles).length||this.video.readyState<2)){var e=this.map.painter.context,i=e.gl;for(var n in this.boundsBuffer||(this.boundsBuffer=e.createVertexBuffer(this._boundsArray,t.rasterBoundsAttributes.members)),this.boundsSegments||(this.boundsSegments=t.SegmentVector.simpleSegment(0,0,4,2)),this.texture?this.video.paused||(this.texture.bind(i.LINEAR,i.CLAMP_TO_EDGE),i.texSubImage2D(i.TEXTURE_2D,0,0,0,i.RGBA,i.UNSIGNED_BYTE,this.video)):(this.texture=new t.Texture(e,this.video,i.RGBA),this.texture.bind(i.LINEAR,i.CLAMP_TO_EDGE)),this.tiles){var o=this.tiles[n];"loaded"!==o.state&&(o.state="loaded",o.texture=this.texture);}}},i.prototype.serialize=function(){return {type:"video",urls:this.urls,coordinates:this.coordinates}},i.prototype.hasTransition=function(){return this.video&&!this.video.paused},i}(W),H=function(e){function i(i,n,o,r){e.call(this,i,n,o,r),n.coordinates?Array.isArray(n.coordinates)&&4===n.coordinates.length&&!n.coordinates.some(function(t){return !Array.isArray(t)||2!==t.length||t.some(function(t){return "number"!=typeof t})})||this.fire(new t.ErrorEvent(new t.ValidationError("sources."+i,null,'"coordinates" property must be an array of 4 longitude/latitude array pairs'))):this.fire(new t.ErrorEvent(new t.ValidationError("sources."+i,null,'missing required property "coordinates"'))),n.animate&&"boolean"!=typeof n.animate&&this.fire(new t.ErrorEvent(new t.ValidationError("sources."+i,null,'optional "animate" property must be a boolean value'))),n.canvas?"string"==typeof n.canvas||n.canvas instanceof t.window.HTMLCanvasElement||this.fire(new t.ErrorEvent(new t.ValidationError("sources."+i,null,'"canvas" must be either a string representing the ID of the canvas element from which to read, or an HTMLCanvasElement instance'))):this.fire(new t.ErrorEvent(new t.ValidationError("sources."+i,null,'missing required property "canvas"'))),this.options=n,this.animate=void 0===n.animate||n.animate;}return e&&(i.__proto__=e),i.prototype=Object.create(e&&e.prototype),i.prototype.constructor=i,i.prototype.load=function(){this.canvas||(this.canvas=this.options.canvas instanceof t.window.HTMLCanvasElement?this.options.canvas:t.window.document.getElementById(this.options.canvas)),this.width=this.canvas.width,this.height=this.canvas.height,this._hasInvalidDimensions()?this.fire(new t.ErrorEvent(new Error("Canvas dimensions cannot be less than or equal to zero."))):(this.play=function(){this._playing=!0,this.map._rerender();},this.pause=function(){this._playing=!1;},this._finishLoading());},i.prototype.getCanvas=function(){return this.canvas},i.prototype.onAdd=function(t){this.map=t,this.load(),this.canvas&&this.animate&&this.play();},i.prototype.onRemove=function(){this.pause();},i.prototype.prepare=function(){var e=!1;if(this.canvas.width!==this.width&&(this.width=this.canvas.width,e=!0),this.canvas.height!==this.height&&(this.height=this.canvas.height,e=!0),!this._hasInvalidDimensions()&&0!==Object.keys(this.tiles).length){var i=this.map.painter.context,n=i.gl;for(var o in this.boundsBuffer||(this.boundsBuffer=i.createVertexBuffer(this._boundsArray,t.rasterBoundsAttributes.members)),this.boundsSegments||(this.boundsSegments=t.SegmentVector.simpleSegment(0,0,4,2)),this.texture?e?this.texture.update(this.canvas):this._playing&&(this.texture.bind(n.LINEAR,n.CLAMP_TO_EDGE),n.texSubImage2D(n.TEXTURE_2D,0,0,0,n.RGBA,n.UNSIGNED_BYTE,this.canvas)):(this.texture=new t.Texture(i,this.canvas,n.RGBA),this.texture.bind(n.LINEAR,n.CLAMP_TO_EDGE)),this.tiles){var r=this.tiles[o];"loaded"!==r.state&&(r.state="loaded",r.texture=this.texture);}}},i.prototype.serialize=function(){return {type:"canvas",coordinates:this.coordinates}},i.prototype.hasTransition=function(){return this._playing},i.prototype._hasInvalidDimensions=function(){for(var t=0,e=[this.canvas.width,this.canvas.height];t<e.length;t+=1){var i=e[t];if(isNaN(i)||i<=0)return !0}return !1},i}(W),K={vector:q,raster:V,"raster-dem":j,geojson:G,video:X,image:W,canvas:H},Y=function(e,i,n,o){var r=new K[i.type](e,i,n,o);if(r.id!==e)throw new Error("Expected Source id to be "+e+" instead of "+r.id);return t.bindAll(["load","abort","unload","serialize","prepare"],r),r};function J(t,e,i,n,o){var r=o.maxPitchScaleFactor(),a=t.tilesIn(i,r);a.sort(Q);for(var s=[],l=0,c=a;l<c.length;l+=1){var h=c[l];s.push({wrappedTileID:h.tileID.wrapped().key,queryResults:h.tile.queryRenderedFeatures(e,t._state,h.queryGeometry,h.scale,n,o,r,t.transform.calculatePosMatrix(h.tileID.toUnwrapped()))});}var u=function(t){for(var e={},i={},n=0,o=t;n<o.length;n+=1){var r=o[n],a=r.queryResults,s=r.wrappedTileID,l=i[s]=i[s]||{};for(var c in a)for(var h=a[c],u=l[c]=l[c]||{},p=e[c]=e[c]||[],d=0,_=h;d<_.length;d+=1){var f=_[d];u[f.featureIndex]||(u[f.featureIndex]=!0,p.push(f.feature));}}return e}(s);for(var p in u)u[p].forEach(function(e){var i=t.getFeatureState(e.layer["source-layer"],e.id);e.source=e.layer.source,e.layer["source-layer"]&&(e.sourceLayer=e.layer["source-layer"]),e.state=i;});return u}function Q(t,e){var i=t.tileID,n=e.tileID;return i.overscaledZ-n.overscaledZ||i.canonical.y-n.canonical.y||i.wrap-n.wrap||i.canonical.x-n.canonical.x}var $=function(t,e){this.max=t,this.onRemove=e,this.reset();};$.prototype.reset=function(){for(var t in this.data)for(var e=0,i=this.data[t];e<i.length;e+=1){var n=i[e];n.timeout&&clearTimeout(n.timeout),this.onRemove(n.value);}return this.data={},this.order=[],this},$.prototype.add=function(t,e,i){var n=this,o=t.wrapped().key;void 0===this.data[o]&&(this.data[o]=[]);var r={value:e,timeout:void 0};if(void 0!==i&&(r.timeout=setTimeout(function(){n.remove(t,r);},i)),this.data[o].push(r),this.order.push(o),this.order.length>this.max){var a=this._getAndRemoveByKey(this.order[0]);a&&this.onRemove(a);}return this},$.prototype.has=function(t){return t.wrapped().key in this.data},$.prototype.getAndRemove=function(t){return this.has(t)?this._getAndRemoveByKey(t.wrapped().key):null},$.prototype._getAndRemoveByKey=function(t){var e=this.data[t].shift();return e.timeout&&clearTimeout(e.timeout),0===this.data[t].length&&delete this.data[t],this.order.splice(this.order.indexOf(t),1),e.value},$.prototype.get=function(t){return this.has(t)?this.data[t.wrapped().key][0].value:null},$.prototype.remove=function(t,e){if(!this.has(t))return this;var i=t.wrapped().key,n=void 0===e?0:this.data[i].indexOf(e),o=this.data[i][n];return this.data[i].splice(n,1),o.timeout&&clearTimeout(o.timeout),0===this.data[i].length&&delete this.data[i],this.onRemove(o.value),this.order.splice(this.order.indexOf(i),1),this},$.prototype.setMaxSize=function(t){for(this.max=t;this.order.length>this.max;){var e=this._getAndRemoveByKey(this.order[0]);e&&this.onRemove(e);}return this};var tt=function(t,e,i){this.context=t;var n=t.gl;this.buffer=n.createBuffer(),this.dynamicDraw=Boolean(i),this.unbindVAO(),t.bindElementBuffer.set(this.buffer),n.bufferData(n.ELEMENT_ARRAY_BUFFER,e.arrayBuffer,this.dynamicDraw?n.DYNAMIC_DRAW:n.STATIC_DRAW),this.dynamicDraw||delete e.arrayBuffer;};tt.prototype.unbindVAO=function(){this.context.extVertexArrayObject&&this.context.bindVertexArrayOES.set(null);},tt.prototype.bind=function(){this.context.bindElementBuffer.set(this.buffer);},tt.prototype.updateData=function(t){var e=this.context.gl;this.unbindVAO(),this.bind(),e.bufferSubData(e.ELEMENT_ARRAY_BUFFER,0,t.arrayBuffer);},tt.prototype.destroy=function(){var t=this.context.gl;this.buffer&&(t.deleteBuffer(this.buffer),delete this.buffer);};var et={Int8:"BYTE",Uint8:"UNSIGNED_BYTE",Int16:"SHORT",Uint16:"UNSIGNED_SHORT",Int32:"INT",Uint32:"UNSIGNED_INT",Float32:"FLOAT"},it=function(t,e,i,n){this.length=e.length,this.attributes=i,this.itemSize=e.bytesPerElement,this.dynamicDraw=n,this.context=t;var o=t.gl;this.buffer=o.createBuffer(),t.bindVertexBuffer.set(this.buffer),o.bufferData(o.ARRAY_BUFFER,e.arrayBuffer,this.dynamicDraw?o.DYNAMIC_DRAW:o.STATIC_DRAW),this.dynamicDraw||delete e.arrayBuffer;};it.prototype.bind=function(){this.context.bindVertexBuffer.set(this.buffer);},it.prototype.updateData=function(t){var e=this.context.gl;this.bind(),e.bufferSubData(e.ARRAY_BUFFER,0,t.arrayBuffer);},it.prototype.enableAttributes=function(t,e){for(var i=0;i<this.attributes.length;i++){var n=this.attributes[i],o=e.attributes[n.name];void 0!==o&&t.enableVertexAttribArray(o);}},it.prototype.setVertexAttribPointers=function(t,e,i){for(var n=0;n<this.attributes.length;n++){var o=this.attributes[n],r=e.attributes[o.name];void 0!==r&&t.vertexAttribPointer(r,o.components,t[et[o.type]],!1,this.itemSize,o.offset+this.itemSize*(i||0));}},it.prototype.destroy=function(){var t=this.context.gl;this.buffer&&(t.deleteBuffer(this.buffer),delete this.buffer);};var nt=function(e){this.context=e,this.current=t.Color.transparent;};nt.prototype.get=function(){return this.current},nt.prototype.set=function(t){var e=this.current;t.r===e.r&&t.g===e.g&&t.b===e.b&&t.a===e.a||(this.context.gl.clearColor(t.r,t.g,t.b,t.a),this.current=t);};var ot=function(t){this.context=t,this.current=1;};ot.prototype.get=function(){return this.current},ot.prototype.set=function(t){this.current!==t&&(this.context.gl.clearDepth(t),this.current=t);};var rt=function(t){this.context=t,this.current=0;};rt.prototype.get=function(){return this.current},rt.prototype.set=function(t){this.current!==t&&(this.context.gl.clearStencil(t),this.current=t);};var at=function(t){this.context=t,this.current=[!0,!0,!0,!0];};at.prototype.get=function(){return this.current},at.prototype.set=function(t){var e=this.current;t[0]===e[0]&&t[1]===e[1]&&t[2]===e[2]&&t[3]===e[3]||(this.context.gl.colorMask(t[0],t[1],t[2],t[3]),this.current=t);};var st=function(t){this.context=t,this.current=!0;};st.prototype.get=function(){return this.current},st.prototype.set=function(t){this.current!==t&&(this.context.gl.depthMask(t),this.current=t);};var lt=function(t){this.context=t,this.current=255;};lt.prototype.get=function(){return this.current},lt.prototype.set=function(t){this.current!==t&&(this.context.gl.stencilMask(t),this.current=t);};var ct=function(t){this.context=t,this.current={func:t.gl.ALWAYS,ref:0,mask:255};};ct.prototype.get=function(){return this.current},ct.prototype.set=function(t){var e=this.current;t.func===e.func&&t.ref===e.ref&&t.mask===e.mask||(this.context.gl.stencilFunc(t.func,t.ref,t.mask),this.current=t);};var ht=function(t){this.context=t;var e=this.context.gl;this.current=[e.KEEP,e.KEEP,e.KEEP];};ht.prototype.get=function(){return this.current},ht.prototype.set=function(t){var e=this.current;t[0]===e[0]&&t[1]===e[1]&&t[2]===e[2]||(this.context.gl.stencilOp(t[0],t[1],t[2]),this.current=t);};var ut=function(t){this.context=t,this.current=!1;};ut.prototype.get=function(){return this.current},ut.prototype.set=function(t){if(this.current!==t){var e=this.context.gl;t?e.enable(e.STENCIL_TEST):e.disable(e.STENCIL_TEST),this.current=t;}};var pt=function(t){this.context=t,this.current=[0,1];};pt.prototype.get=function(){return this.current},pt.prototype.set=function(t){var e=this.current;t[0]===e[0]&&t[1]===e[1]||(this.context.gl.depthRange(t[0],t[1]),this.current=t);};var dt=function(t){this.context=t,this.current=!1;};dt.prototype.get=function(){return this.current},dt.prototype.set=function(t){if(this.current!==t){var e=this.context.gl;t?e.enable(e.DEPTH_TEST):e.disable(e.DEPTH_TEST),this.current=t;}};var _t=function(t){this.context=t,this.current=t.gl.LESS;};_t.prototype.get=function(){return this.current},_t.prototype.set=function(t){this.current!==t&&(this.context.gl.depthFunc(t),this.current=t);};var ft=function(t){this.context=t,this.current=!1;};ft.prototype.get=function(){return this.current},ft.prototype.set=function(t){if(this.current!==t){var e=this.context.gl;t?e.enable(e.BLEND):e.disable(e.BLEND),this.current=t;}};var mt=function(t){this.context=t;var e=this.context.gl;this.current=[e.ONE,e.ZERO];};mt.prototype.get=function(){return this.current},mt.prototype.set=function(t){var e=this.current;t[0]===e[0]&&t[1]===e[1]||(this.context.gl.blendFunc(t[0],t[1]),this.current=t);};var gt=function(e){this.context=e,this.current=t.Color.transparent;};gt.prototype.get=function(){return this.current},gt.prototype.set=function(t){var e=this.current;t.r===e.r&&t.g===e.g&&t.b===e.b&&t.a===e.a||(this.context.gl.blendColor(t.r,t.g,t.b,t.a),this.current=t);};var vt=function(t){this.context=t,this.current=null;};vt.prototype.get=function(){return this.current},vt.prototype.set=function(t){this.current!==t&&(this.context.gl.useProgram(t),this.current=t);};var yt=function(t){this.context=t,this.current=t.gl.TEXTURE0;};yt.prototype.get=function(){return this.current},yt.prototype.set=function(t){this.current!==t&&(this.context.gl.activeTexture(t),this.current=t);};var xt=function(t){this.context=t;var e=this.context.gl;this.current=[0,0,e.drawingBufferWidth,e.drawingBufferHeight];};xt.prototype.get=function(){return this.current},xt.prototype.set=function(t){var e=this.current;t[0]===e[0]&&t[1]===e[1]&&t[2]===e[2]&&t[3]===e[3]||(this.context.gl.viewport(t[0],t[1],t[2],t[3]),this.current=t);};var bt=function(t){this.context=t,this.current=null;};bt.prototype.get=function(){return this.current},bt.prototype.set=function(t){if(this.current!==t){var e=this.context.gl;e.bindFramebuffer(e.FRAMEBUFFER,t),this.current=t;}};var wt=function(t){this.context=t,this.current=null;};wt.prototype.get=function(){return this.current},wt.prototype.set=function(t){if(this.current!==t){var e=this.context.gl;e.bindRenderbuffer(e.RENDERBUFFER,t),this.current=t;}};var Et=function(t){this.context=t,this.current=null;};Et.prototype.get=function(){return this.current},Et.prototype.set=function(t){if(this.current!==t){var e=this.context.gl;e.bindTexture(e.TEXTURE_2D,t),this.current=t;}};var Tt=function(t){this.context=t,this.current=null;};Tt.prototype.get=function(){return this.current},Tt.prototype.set=function(t){if(this.current!==t){var e=this.context.gl;e.bindBuffer(e.ARRAY_BUFFER,t),this.current=t;}};var St=function(t){this.context=t,this.current=null;};St.prototype.get=function(){return this.current},St.prototype.set=function(t){var e=this.context.gl;e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,t),this.current=t;};var It=function(t){this.context=t,this.current=null;};It.prototype.get=function(){return this.current},It.prototype.set=function(t){this.current!==t&&this.context.extVertexArrayObject&&(this.context.extVertexArrayObject.bindVertexArrayOES(t),this.current=t);};var Ct=function(t){this.context=t,this.current=4;};Ct.prototype.get=function(){return this.current},Ct.prototype.set=function(t){if(this.current!==t){var e=this.context.gl;e.pixelStorei(e.UNPACK_ALIGNMENT,t),this.current=t;}};var zt=function(t){this.context=t,this.current=!1;};zt.prototype.get=function(){return this.current},zt.prototype.set=function(t){if(this.current!==t){var e=this.context.gl;e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,t),this.current=t;}};var Pt=function(t,e){this.context=t,this.current=null,this.parent=e;};Pt.prototype.get=function(){return this.current};var Rt=function(t){function e(e,i){t.call(this,e,i),this.dirty=!1;}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.set=function(t){if(this.dirty||this.current!==t){var e=this.context.gl;this.context.bindFramebuffer.set(this.parent),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,t,0),this.current=t,this.dirty=!1;}},e.prototype.setDirty=function(){this.dirty=!0;},e}(Pt),At=function(t){function e(){t.apply(this,arguments);}return t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e,e.prototype.set=function(t){if(this.current!==t){var e=this.context.gl;this.context.bindFramebuffer.set(this.parent),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.DEPTH_ATTACHMENT,e.RENDERBUFFER,t),this.current=t;}},e}(Pt),Lt=function(t,e,i){this.context=t,this.width=e,this.height=i;var n=t.gl,o=this.framebuffer=n.createFramebuffer();this.colorAttachment=new Rt(t,o),this.depthAttachment=new At(t,o);};Lt.prototype.destroy=function(){var t=this.context.gl,e=this.colorAttachment.get();e&&t.deleteTexture(e);var i=this.depthAttachment.get();i&&t.deleteRenderbuffer(i),t.deleteFramebuffer(this.framebuffer);};var Dt=function(t,e,i){this.func=t,this.mask=e,this.range=i;};Dt.ReadOnly=!1,Dt.ReadWrite=!0,Dt.disabled=new Dt(519,Dt.ReadOnly,[0,1]);var Mt=function(t,e,i,n,o,r){this.test=t,this.ref=e,this.mask=i,this.fail=n,this.depthFail=o,this.pass=r;};Mt.disabled=new Mt({func:519,mask:0},0,0,7680,7680,7680);var kt=function(t,e,i){this.blendFunction=t,this.blendColor=e,this.mask=i;};kt.Replace=[1,0],kt.disabled=new kt(kt.Replace,t.Color.transparent,[!1,!1,!1,!1]),kt.unblended=new kt(kt.Replace,t.Color.transparent,[!0,!0,!0,!0]),kt.alphaBlended=new kt([1,771],t.Color.transparent,[!0,!0,!0,!0]);var Bt=function(t){this.gl=t,this.extVertexArrayObject=this.gl.getExtension("OES_vertex_array_object"),this.clearColor=new nt(this),this.clearDepth=new ot(this),this.clearStencil=new rt(this),this.colorMask=new at(this),this.depthMask=new st(this),this.stencilMask=new lt(this),this.stencilFunc=new ct(this),this.stencilOp=new ht(this),this.stencilTest=new ut(this),this.depthRange=new pt(this),this.depthTest=new dt(this),this.depthFunc=new _t(this),this.blend=new ft(this),this.blendFunc=new mt(this),this.blendColor=new gt(this),this.program=new vt(this),this.activeTexture=new yt(this),this.viewport=new xt(this),this.bindFramebuffer=new bt(this),this.bindRenderbuffer=new wt(this),this.bindTexture=new Et(this),this.bindVertexBuffer=new Tt(this),this.bindElementBuffer=new St(this),this.bindVertexArrayOES=this.extVertexArrayObject&&new It(this),this.pixelStoreUnpack=new Ct(this),this.pixelStoreUnpackPremultiplyAlpha=new zt(this),this.extTextureFilterAnisotropic=t.getExtension("EXT_texture_filter_anisotropic")||t.getExtension("MOZ_EXT_texture_filter_anisotropic")||t.getExtension("WEBKIT_EXT_texture_filter_anisotropic"),this.extTextureFilterAnisotropic&&(this.extTextureFilterAnisotropicMax=t.getParameter(this.extTextureFilterAnisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT)),this.extTextureHalfFloat=t.getExtension("OES_texture_half_float"),this.extTextureHalfFloat&&t.getExtension("OES_texture_half_float_linear");};Bt.prototype.createIndexBuffer=function(t,e){return new tt(this,t,e)},Bt.prototype.createVertexBuffer=function(t,e,i){return new it(this,t,e,i)},Bt.prototype.createRenderbuffer=function(t,e,i){var n=this.gl,o=n.createRenderbuffer();return this.bindRenderbuffer.set(o),n.renderbufferStorage(n.RENDERBUFFER,t,e,i),this.bindRenderbuffer.set(null),o},Bt.prototype.createFramebuffer=function(t,e){return new Lt(this,t,e)},Bt.prototype.clear=function(t){var e=t.color,i=t.depth,n=this.gl,o=0;e&&(o|=n.COLOR_BUFFER_BIT,this.clearColor.set(e),this.colorMask.set([!0,!0,!0,!0])),void 0!==i&&(o|=n.DEPTH_BUFFER_BIT,this.clearDepth.set(i),this.depthMask.set(!0)),n.clear(o);},Bt.prototype.setDepthMode=function(t){t.func!==this.gl.ALWAYS||t.mask?(this.depthTest.set(!0),this.depthFunc.set(t.func),this.depthMask.set(t.mask),this.depthRange.set(t.range)):this.depthTest.set(!1);},Bt.prototype.setStencilMode=function(t){t.test.func!==this.gl.ALWAYS||t.mask?(this.stencilTest.set(!0),this.stencilMask.set(t.mask),this.stencilOp.set([t.fail,t.depthFail,t.pass]),this.stencilFunc.set({func:t.test.func,ref:t.ref,mask:t.test.mask})):this.stencilTest.set(!1);},Bt.prototype.setColorMode=function(e){t.deepEqual(e.blendFunction,kt.Replace)?this.blend.set(!1):(this.blend.set(!0),this.blendFunc.set(e.blendFunction),this.blendColor.set(e.blendColor)),this.colorMask.set(e.mask);};var Ot=function(e){function i(i,n,o){var r=this;e.call(this),this.id=i,this.dispatcher=o,this.on("data",function(t){"source"===t.dataType&&"metadata"===t.sourceDataType&&(r._sourceLoaded=!0),r._sourceLoaded&&!r._paused&&"source"===t.dataType&&"content"===t.sourceDataType&&(r.reload(),r.transform&&r.update(r.transform));}),this.on("error",function(){r._sourceErrored=!0;}),this._source=Y(i,n,o,this),this._tiles={},this._cache=new $(0,this._unloadTile.bind(this)),this._timers={},this._cacheTimers={},this._maxTileCacheSize=null,this._coveredTiles={},this._state=new t.SourceFeatureState;}return e&&(i.__proto__=e),i.prototype=Object.create(e&&e.prototype),i.prototype.constructor=i,i.prototype.onAdd=function(t){this.map=t,this._maxTileCacheSize=t?t._maxTileCacheSize:null,this._source&&this._source.onAdd&&this._source.onAdd(t);},i.prototype.onRemove=function(t){this._source&&this._source.onRemove&&this._source.onRemove(t);},i.prototype.loaded=function(){if(this._sourceErrored)return !0;if(!this._sourceLoaded)return !1;for(var t in this._tiles){var e=this._tiles[t];if("loaded"!==e.state&&"errored"!==e.state)return !1}return !0},i.prototype.getSource=function(){return this._source},i.prototype.pause=function(){this._paused=!0;},i.prototype.resume=function(){if(this._paused){var t=this._shouldReloadOnResume;this._paused=!1,this._shouldReloadOnResume=!1,t&&this.reload(),this.transform&&this.update(this.transform);}},i.prototype._loadTile=function(t,e){return this._source.loadTile(t,e)},i.prototype._unloadTile=function(t){if(this._source.unloadTile)return this._source.unloadTile(t,function(){})},i.prototype._abortTile=function(t){if(this._source.abortTile)return this._source.abortTile(t,function(){})},i.prototype.serialize=function(){return this._source.serialize()},i.prototype.prepare=function(t){for(var e in this._source.prepare&&this._source.prepare(),this._state.coalesceChanges(this._tiles,this.map?this.map.painter:null),this._tiles)this._tiles[e].upload(t);},i.prototype.getIds=function(){return Object.keys(this._tiles).map(Number).sort(Ut)},i.prototype.getRenderableIds=function(e){var i=this,n=[];for(var o in i._tiles)i._isIdRenderable(+o,e)&&n.push(+o);return e?n.sort(function(e,n){var o=i._tiles[e].tileID,r=i._tiles[n].tileID,a=new t.Point(o.canonical.x,o.canonical.y)._rotate(i.transform.angle),s=new t.Point(r.canonical.x,r.canonical.y)._rotate(i.transform.angle);return o.overscaledZ-r.overscaledZ||s.y-a.y||s.x-a.x}):n.sort(Ut)},i.prototype.hasRenderableParent=function(t){var e=this.findLoadedParent(t,0);return !!e&&this._isIdRenderable(e.tileID.key)},i.prototype._isIdRenderable=function(t,e){return this._tiles[t]&&this._tiles[t].hasData()&&!this._coveredTiles[t]&&(e||!this._tiles[t].holdingForFade())},i.prototype.reload=function(){if(this._paused)this._shouldReloadOnResume=!0;else for(var t in this._cache.reset(),this._tiles)"errored"!==this._tiles[t].state&&this._reloadTile(t,"reloading");},i.prototype._reloadTile=function(t,e){var i=this._tiles[t];i&&("loading"!==i.state&&(i.state=e),this._loadTile(i,this._tileLoaded.bind(this,i,t,e)));},i.prototype._tileLoaded=function(e,i,n,o){if(o)return e.state="errored",void(404!==o.status?this._source.fire(new t.ErrorEvent(o,{tile:e})):this.update(this.transform));e.timeAdded=t.browser.now(),"expired"===n&&(e.refreshedUponExpiration=!0),this._setTileReloadTimer(i,e),"raster-dem"===this.getSource().type&&e.dem&&this._backfillDEM(e),this._state.initializeTileState(e,this.map?this.map.painter:null),this._source.fire(new t.Event("data",{dataType:"source",tile:e,coord:e.tileID}));},i.prototype._backfillDEM=function(t){for(var e=this.getRenderableIds(),i=0;i<e.length;i++){var n=e[i];if(t.neighboringTiles&&t.neighboringTiles[n]){var o=this.getTileByID(n);r(t,o),r(o,t);}}function r(t,e){t.needsHillshadePrepare=!0;var i=e.tileID.canonical.x-t.tileID.canonical.x,n=e.tileID.canonical.y-t.tileID.canonical.y,o=Math.pow(2,t.tileID.canonical.z),r=e.tileID.key;0===i&&0===n||Math.abs(n)>1||(Math.abs(i)>1&&(1===Math.abs(i+o)?i+=o:1===Math.abs(i-o)&&(i-=o)),e.dem&&t.dem&&(t.dem.backfillBorder(e.dem,i,n),t.neighboringTiles&&t.neighboringTiles[r]&&(t.neighboringTiles[r].backfilled=!0)));}},i.prototype.getTile=function(t){return this.getTileByID(t.key)},i.prototype.getTileByID=function(t){return this._tiles[t]},i.prototype.getZoom=function(t){return t.zoom+t.scaleZoom(t.tileSize/this._source.tileSize)},i.prototype._retainLoadedChildren=function(t,e,i,n){for(var o in this._tiles){var r=this._tiles[o];if(!(n[o]||!r.hasData()||r.tileID.overscaledZ<=e||r.tileID.overscaledZ>i)){for(var a=r.tileID;r&&r.tileID.overscaledZ>e+1;){var s=r.tileID.scaledTo(r.tileID.overscaledZ-1);(r=this._tiles[s.key])&&r.hasData()&&(a=s);}for(var l=a;l.overscaledZ>e;)if(t[(l=l.scaledTo(l.overscaledZ-1)).key]){n[a.key]=a;break}}}},i.prototype.findLoadedParent=function(t,e){for(var i=t.overscaledZ-1;i>=e;i--){var n=t.scaledTo(i);if(!n)return;var o=String(n.key),r=this._tiles[o];if(r&&r.hasData())return r;if(this._cache.has(n))return this._cache.get(n)}},i.prototype.updateCacheSize=function(t){var e=(Math.ceil(t.width/this._source.tileSize)+1)*(Math.ceil(t.height/this._source.tileSize)+1),i=Math.floor(5*e),n="number"==typeof this._maxTileCacheSize?Math.min(this._maxTileCacheSize,i):i;this._cache.setMaxSize(n);},i.prototype.handleWrapJump=function(t){var e=(t-(void 0===this._prevLng?t:this._prevLng))/360,i=Math.round(e);if(this._prevLng=t,i){var n={};for(var o in this._tiles){var r=this._tiles[o];r.tileID=r.tileID.unwrapTo(r.tileID.wrap+i),n[r.tileID.key]=r;}for(var a in this._tiles=n,this._timers)clearTimeout(this._timers[a]),delete this._timers[a];for(var s in this._tiles){var l=this._tiles[s];this._setTileReloadTimer(s,l);}}},i.prototype.update=function(e){var n=this;if(this.transform=e,this._sourceLoaded&&!this._paused){var o;this.updateCacheSize(e),this.handleWrapJump(this.transform.center.lng),this._coveredTiles={},this.used?this._source.tileID?o=e.getVisibleUnwrappedCoordinates(this._source.tileID).map(function(e){return new t.OverscaledTileID(e.canonical.z,e.wrap,e.canonical.z,e.canonical.x,e.canonical.y)}):(o=e.coveringTiles({tileSize:this._source.tileSize,minzoom:this._source.minzoom,maxzoom:this._source.maxzoom,roundZoom:this._source.roundZoom,reparseOverscaled:this._source.reparseOverscaled}),this._source.hasTile&&(o=o.filter(function(t){return n._source.hasTile(t)}))):o=[];var r=(this._source.roundZoom?Math.round:Math.floor)(this.getZoom(e)),a=Math.max(r-i.maxOverzooming,this._source.minzoom),s=Math.max(r+i.maxUnderzooming,this._source.minzoom),l=this._updateRetainedTiles(o,r);if(Nt(this._source.type)){for(var c={},h={},u=0,p=Object.keys(l);u<p.length;u+=1){var d=p[u],_=l[d],f=n._tiles[d];if(f&&!(f.fadeEndTime&&f.fadeEndTime<=t.browser.now())){var m=n.findLoadedParent(_,a);m&&(n._addTile(m.tileID),c[m.tileID.key]=m.tileID),h[d]=_;}}for(var g in this._retainLoadedChildren(h,r,s,l),c)l[g]||(n._coveredTiles[g]=!0,l[g]=c[g]);}for(var v in l)n._tiles[v].clearFadeHold();for(var y=0,x=t.keysDifference(this._tiles,l);y<x.length;y+=1){var b=x[y],w=n._tiles[b];w.hasSymbolBuckets&&!w.holdingForFade()?w.setHoldDuration(n.map._fadeDuration):w.hasSymbolBuckets&&!w.symbolFadeFinished()||n._removeTile(b);}}},i.prototype.releaseSymbolFadeTiles=function(){for(var t in this._tiles)this._tiles[t].holdingForFade()&&this._removeTile(t);},i.prototype._updateRetainedTiles=function(t,e){for(var n={},o={},r=Math.max(e-i.maxOverzooming,this._source.minzoom),a=Math.max(e+i.maxUnderzooming,this._source.minzoom),s={},l=0,c=t;l<c.length;l+=1){var h=c[l],u=this._addTile(h);n[h.key]=h,u.hasData()||e<this._source.maxzoom&&(s[h.key]=h);}this._retainLoadedChildren(s,e,a,n);for(var p=0,d=t;p<d.length;p+=1){var _=d[p],f=this._tiles[_.key];if(!f.hasData()){if(e+1>this._source.maxzoom){var m=_.children(this._source.maxzoom)[0],g=this.getTile(m);if(g&&g.hasData()){n[m.key]=m;continue}}else{var v=_.children(this._source.maxzoom);if(n[v[0].key]&&n[v[1].key]&&n[v[2].key]&&n[v[3].key])continue}for(var y=f.wasRequested(),x=_.overscaledZ-1;x>=r;--x){var b=_.scaledTo(x);if(o[b.key])break;if(o[b.key]=!0,!(f=this.getTile(b))&&y&&(f=this._addTile(b)),f&&(n[b.key]=b,y=f.wasRequested(),f.hasData()))break}}}return n},i.prototype._addTile=function(e){var i=this._tiles[e.key];if(i)return i;(i=this._cache.getAndRemove(e))&&(this._setTileReloadTimer(e.key,i),i.tileID=e,this._state.initializeTileState(i,this.map?this.map.painter:null),this._cacheTimers[e.key]&&(clearTimeout(this._cacheTimers[e.key]),delete this._cacheTimers[e.key],this._setTileReloadTimer(e.key,i)));var n=Boolean(i);return n||(i=new t.Tile(e,this._source.tileSize*e.overscaleFactor()),this._loadTile(i,this._tileLoaded.bind(this,i,e.key,i.state))),i?(i.uses++,this._tiles[e.key]=i,n||this._source.fire(new t.Event("dataloading",{tile:i,coord:i.tileID,dataType:"source"})),i):null},i.prototype._setTileReloadTimer=function(t,e){var i=this;t in this._timers&&(clearTimeout(this._timers[t]),delete this._timers[t]);var n=e.getExpiryTimeout();n&&(this._timers[t]=setTimeout(function(){i._reloadTile(t,"expired"),delete i._timers[t];},n));},i.prototype._removeTile=function(t){var e=this._tiles[t];e&&(e.uses--,delete this._tiles[t],this._timers[t]&&(clearTimeout(this._timers[t]),delete this._timers[t]),e.uses>0||(e.hasData()?this._cache.add(e.tileID,e,e.getExpiryTimeout()):(e.aborted=!0,this._abortTile(e),this._unloadTile(e))));},i.prototype.clearTiles=function(){for(var t in this._shouldReloadOnResume=!1,this._paused=!1,this._tiles)this._removeTile(t);this._cache.reset();},i.prototype.tilesIn=function(e,i){for(var n=[],o=this.getIds(),r=1/0,a=1/0,s=-1/0,l=-1/0,c=e[0].zoom,h=0;h<e.length;h++){var u=e[h];r=Math.min(r,u.column),a=Math.min(a,u.row),s=Math.max(s,u.column),l=Math.max(l,u.row);}for(var p=0;p<o.length;p++){var d=this._tiles[o[p]];if(!d.holdingForFade()){var _=d.tileID,f=Math.pow(2,this.transform.zoom-d.tileID.overscaledZ),m=i*d.queryPadding*t.EXTENT/d.tileSize/f,g=[Ft(_,new t.Coordinate(r,a,c)),Ft(_,new t.Coordinate(s,l,c))];if(g[0].x-m<t.EXTENT&&g[0].y-m<t.EXTENT&&g[1].x+m>=0&&g[1].y+m>=0){for(var v=[],y=0;y<e.length;y++)v.push(Ft(_,e[y]));n.push({tile:d,tileID:_,queryGeometry:[v],scale:f});}}}return n},i.prototype.getVisibleCoordinates=function(t){for(var e=this,i=this.getRenderableIds(t).map(function(t){return e._tiles[t].tileID}),n=0,o=i;n<o.length;n+=1){var r=o[n];r.posMatrix=e.transform.calculatePosMatrix(r.toUnwrapped());}return i},i.prototype.hasTransition=function(){if(this._source.hasTransition())return !0;if(Nt(this._source.type))for(var e in this._tiles){var i=this._tiles[e];if(void 0!==i.fadeEndTime&&i.fadeEndTime>=t.browser.now())return !0}return !1},i.prototype.setFeatureState=function(t,e,i){t=t||"_geojsonTileLayer",this._state.updateState(t,e,i);},i.prototype.getFeatureState=function(t,e){return t=t||"_geojsonTileLayer",this._state.getState(t,e)},i}(t.Evented);function Ft(e,i){var n=i.zoomTo(e.canonical.z);return new t.Point((n.column-(e.canonical.x+e.wrap*Math.pow(2,e.canonical.z)))*t.EXTENT,(n.row-e.canonical.y)*t.EXTENT)}function Ut(t,e){return t%32-e%32||e-t}function Nt(t){return "raster"===t||"image"===t||"video"===t}function Zt(){return new t.window.Worker(kn.workerUrl)}Ot.maxOverzooming=10,Ot.maxUnderzooming=3;var qt,Vt=function(){this.active={};};function jt(e,i){var n={};for(var o in e)"ref"!==o&&(n[o]=e[o]);return t.refProperties.forEach(function(t){t in i&&(n[t]=i[t]);}),n}function Gt(t){t=t.slice();for(var e=Object.create(null),i=0;i<t.length;i++)e[t[i].id]=t[i];for(var n=0;n<t.length;n++)"ref"in t[n]&&(t[n]=jt(t[n],e[t[n].ref]));return t}Vt.prototype.acquire=function(t){if(!this.workers)for(this.workers=[];this.workers.length<Vt.workerCount;)this.workers.push(new Zt);return this.active[t]=!0,this.workers.slice()},Vt.prototype.release=function(t){delete this.active[t],0===Object.keys(this.active).length&&(this.workers.forEach(function(t){t.terminate();}),this.workers=null);},Vt.workerCount=Math.max(Math.floor(t.browser.hardwareConcurrency/2),1);var Wt={setStyle:"setStyle",addLayer:"addLayer",removeLayer:"removeLayer",setPaintProperty:"setPaintProperty",setLayoutProperty:"setLayoutProperty",setFilter:"setFilter",addSource:"addSource",removeSource:"removeSource",setGeoJSONSourceData:"setGeoJSONSourceData",setLayerZoomRange:"setLayerZoomRange",setLayerProperty:"setLayerProperty",setCenter:"setCenter",setZoom:"setZoom",setBearing:"setBearing",setPitch:"setPitch",setSprite:"setSprite",setGlyphs:"setGlyphs",setTransition:"setTransition",setLight:"setLight"};function Xt(t,e,i){i.push({command:Wt.addSource,args:[t,e[t]]});}function Ht(t,e,i){e.push({command:Wt.removeSource,args:[t]}),i[t]=!0;}function Kt(t,e,i,n){Ht(t,i,n),Xt(t,e,i);}function Yt(e,i,n){var o;for(o in e[n])if(e[n].hasOwnProperty(o)&&"data"!==o&&!t.deepEqual(e[n][o],i[n][o]))return !1;for(o in i[n])if(i[n].hasOwnProperty(o)&&"data"!==o&&!t.deepEqual(e[n][o],i[n][o]))return !1;return !0}function Jt(e,i,n,o,r,a){var s;for(s in i=i||{},e=e||{})e.hasOwnProperty(s)&&(t.deepEqual(e[s],i[s])||n.push({command:a,args:[o,s,i[s],r]}));for(s in i)i.hasOwnProperty(s)&&!e.hasOwnProperty(s)&&(t.deepEqual(e[s],i[s])||n.push({command:a,args:[o,s,i[s],r]}));}function Qt(t){return t.id}function $t(t,e){return t[e.id]=e,t}function te(e,i){if(!e)return [{command:Wt.setStyle,args:[i]}];var n=[];try{if(!t.deepEqual(e.version,i.version))return [{command:Wt.setStyle,args:[i]}];t.deepEqual(e.center,i.center)||n.push({command:Wt.setCenter,args:[i.center]}),t.deepEqual(e.zoom,i.zoom)||n.push({command:Wt.setZoom,args:[i.zoom]}),t.deepEqual(e.bearing,i.bearing)||n.push({command:Wt.setBearing,args:[i.bearing]}),t.deepEqual(e.pitch,i.pitch)||n.push({command:Wt.setPitch,args:[i.pitch]}),t.deepEqual(e.sprite,i.sprite)||n.push({command:Wt.setSprite,args:[i.sprite]}),t.deepEqual(e.glyphs,i.glyphs)||n.push({command:Wt.setGlyphs,args:[i.glyphs]}),t.deepEqual(e.transition,i.transition)||n.push({command:Wt.setTransition,args:[i.transition]}),t.deepEqual(e.light,i.light)||n.push({command:Wt.setLight,args:[i.light]});var o={},r=[];!function(e,i,n,o){var r;for(r in i=i||{},e=e||{})e.hasOwnProperty(r)&&(i.hasOwnProperty(r)||Ht(r,n,o));for(r in i)i.hasOwnProperty(r)&&(e.hasOwnProperty(r)?t.deepEqual(e[r],i[r])||("geojson"===e[r].type&&"geojson"===i[r].type&&Yt(e,i,r)?n.push({command:Wt.setGeoJSONSourceData,args:[r,i[r].data]}):Kt(r,i,n,o)):Xt(r,i,n));}(e.sources,i.sources,r,o);var a=[];e.layers&&e.layers.forEach(function(t){o[t.source]?n.push({command:Wt.removeLayer,args:[t.id]}):a.push(t);}),n=n.concat(r),function(e,i,n){i=i||[];var o,r,a,s,l,c,h,u=(e=e||[]).map(Qt),p=i.map(Qt),d=e.reduce($t,{}),_=i.reduce($t,{}),f=u.slice(),m=Object.create(null);for(o=0,r=0;o<u.length;o++)a=u[o],_.hasOwnProperty(a)?r++:(n.push({command:Wt.removeLayer,args:[a]}),f.splice(f.indexOf(a,r),1));for(o=0,r=0;o<p.length;o++)a=p[p.length-1-o],f[f.length-1-o]!==a&&(d.hasOwnProperty(a)?(n.push({command:Wt.removeLayer,args:[a]}),f.splice(f.lastIndexOf(a,f.length-r),1)):r++,c=f[f.length-o],n.push({command:Wt.addLayer,args:[_[a],c]}),f.splice(f.length-o,0,a),m[a]=!0);for(o=0;o<p.length;o++)if(s=d[a=p[o]],l=_[a],!m[a]&&!t.deepEqual(s,l))if(t.deepEqual(s.source,l.source)&&t.deepEqual(s["source-layer"],l["source-layer"])&&t.deepEqual(s.type,l.type)){for(h in Jt(s.layout,l.layout,n,a,null,Wt.setLayoutProperty),Jt(s.paint,l.paint,n,a,null,Wt.setPaintProperty),t.deepEqual(s.filter,l.filter)||n.push({command:Wt.setFilter,args:[a,l.filter]}),t.deepEqual(s.minzoom,l.minzoom)&&t.deepEqual(s.maxzoom,l.maxzoom)||n.push({command:Wt.setLayerZoomRange,args:[a,l.minzoom,l.maxzoom]}),s)s.hasOwnProperty(h)&&"layout"!==h&&"paint"!==h&&"filter"!==h&&"metadata"!==h&&"minzoom"!==h&&"maxzoom"!==h&&(0===h.indexOf("paint.")?Jt(s[h],l[h],n,a,h.slice(6),Wt.setPaintProperty):t.deepEqual(s[h],l[h])||n.push({command:Wt.setLayerProperty,args:[a,h,l[h]]}));for(h in l)l.hasOwnProperty(h)&&!s.hasOwnProperty(h)&&"layout"!==h&&"paint"!==h&&"filter"!==h&&"metadata"!==h&&"minzoom"!==h&&"maxzoom"!==h&&(0===h.indexOf("paint.")?Jt(s[h],l[h],n,a,h.slice(6),Wt.setPaintProperty):t.deepEqual(s[h],l[h])||n.push({command:Wt.setLayerProperty,args:[a,h,l[h]]}));}else n.push({command:Wt.removeLayer,args:[a]}),c=f[f.lastIndexOf(a)+1],n.push({command:Wt.addLayer,args:[l,c]});}(a,i.layers,n);}catch(t){console.warn("Unable to compute style diff:",t),n=[{command:Wt.setStyle,args:[i]}];}return n}var ee=function(t,e,i){var n=this.boxCells=[],o=this.circleCells=[];this.xCellCount=Math.ceil(t/i),this.yCellCount=Math.ceil(e/i);for(var r=0;r<this.xCellCount*this.yCellCount;r++)n.push([]),o.push([]);this.circleKeys=[],this.boxKeys=[],this.bboxes=[],this.circles=[],this.width=t,this.height=e,this.xScale=this.xCellCount/t,this.yScale=this.yCellCount/e,this.boxUid=0,this.circleUid=0;};ee.prototype.keysLength=function(){return this.boxKeys.length+this.circleKeys.length},ee.prototype.insert=function(t,e,i,n,o){this._forEachCell(e,i,n,o,this._insertBoxCell,this.boxUid++),this.boxKeys.push(t),this.bboxes.push(e),this.bboxes.push(i),this.bboxes.push(n),this.bboxes.push(o);},ee.prototype.insertCircle=function(t,e,i,n){this._forEachCell(e-n,i-n,e+n,i+n,this._insertCircleCell,this.circleUid++),this.circleKeys.push(t),this.circles.push(e),this.circles.push(i),this.circles.push(n);},ee.prototype._insertBoxCell=function(t,e,i,n,o,r){this.boxCells[o].push(r);},ee.prototype._insertCircleCell=function(t,e,i,n,o,r){this.circleCells[o].push(r);},ee.prototype._query=function(t,e,i,n,o,r){if(i<0||t>this.width||n<0||e>this.height)return !o&&[];var a=[];if(t<=0&&e<=0&&this.width<=i&&this.height<=n){if(o)return !0;for(var s=0;s<this.boxKeys.length;s++)a.push({key:this.boxKeys[s],x1:this.bboxes[4*s],y1:this.bboxes[4*s+1],x2:this.bboxes[4*s+2],y2:this.bboxes[4*s+3]});for(var l=0;l<this.circleKeys.length;l++){var c=this.circles[3*l],h=this.circles[3*l+1],u=this.circles[3*l+2];a.push({key:this.circleKeys[l],x1:c-u,y1:h-u,x2:c+u,y2:h+u});}return r?a.filter(r):a}var p={hitTest:o,seenUids:{box:{},circle:{}}};return this._forEachCell(t,e,i,n,this._queryCell,a,p,r),o?a.length>0:a},ee.prototype._queryCircle=function(t,e,i,n,o){var r=t-i,a=t+i,s=e-i,l=e+i;if(a<0||r>this.width||l<0||s>this.height)return !n&&[];var c=[],h={hitTest:n,circle:{x:t,y:e,radius:i},seenUids:{box:{},circle:{}}};return this._forEachCell(r,s,a,l,this._queryCellCircle,c,h,o),n?c.length>0:c},ee.prototype.query=function(t,e,i,n,o){return this._query(t,e,i,n,!1,o)},ee.prototype.hitTest=function(t,e,i,n,o){return this._query(t,e,i,n,!0,o)},ee.prototype.hitTestCircle=function(t,e,i,n){return this._queryCircle(t,e,i,!0,n)},ee.prototype._queryCell=function(t,e,i,n,o,r,a,s){var l=a.seenUids,c=this.boxCells[o];if(null!==c)for(var h=this.bboxes,u=0,p=c;u<p.length;u+=1){var d=p[u];if(!l.box[d]){l.box[d]=!0;var _=4*d;if(t<=h[_+2]&&e<=h[_+3]&&i>=h[_+0]&&n>=h[_+1]&&(!s||s(this.boxKeys[d]))){if(a.hitTest)return r.push(!0),!0;r.push({key:this.boxKeys[d],x1:h[_],y1:h[_+1],x2:h[_+2],y2:h[_+3]});}}}var f=this.circleCells[o];if(null!==f)for(var m=this.circles,g=0,v=f;g<v.length;g+=1){var y=v[g];if(!l.circle[y]){l.circle[y]=!0;var x=3*y;if(this._circleAndRectCollide(m[x],m[x+1],m[x+2],t,e,i,n)&&(!s||s(this.circleKeys[y]))){if(a.hitTest)return r.push(!0),!0;var b=m[x],w=m[x+1],E=m[x+2];r.push({key:this.circleKeys[y],x1:b-E,y1:w-E,x2:b+E,y2:w+E});}}}},ee.prototype._queryCellCircle=function(t,e,i,n,o,r,a,s){var l=a.circle,c=a.seenUids,h=this.boxCells[o];if(null!==h)for(var u=this.bboxes,p=0,d=h;p<d.length;p+=1){var _=d[p];if(!c.box[_]){c.box[_]=!0;var f=4*_;if(this._circleAndRectCollide(l.x,l.y,l.radius,u[f+0],u[f+1],u[f+2],u[f+3])&&(!s||s(this.boxKeys[_])))return r.push(!0),!0}}var m=this.circleCells[o];if(null!==m)for(var g=this.circles,v=0,y=m;v<y.length;v+=1){var x=y[v];if(!c.circle[x]){c.circle[x]=!0;var b=3*x;if(this._circlesCollide(g[b],g[b+1],g[b+2],l.x,l.y,l.radius)&&(!s||s(this.circleKeys[x])))return r.push(!0),!0}}},ee.prototype._forEachCell=function(t,e,i,n,o,r,a,s){for(var l=this._convertToXCellCoord(t),c=this._convertToYCellCoord(e),h=this._convertToXCellCoord(i),u=this._convertToYCellCoord(n),p=l;p<=h;p++)for(var d=c;d<=u;d++){var _=this.xCellCount*d+p;if(o.call(this,t,e,i,n,_,r,a,s))return}},ee.prototype._convertToXCellCoord=function(t){return Math.max(0,Math.min(this.xCellCount-1,Math.floor(t*this.xScale)))},ee.prototype._convertToYCellCoord=function(t){return Math.max(0,Math.min(this.yCellCount-1,Math.floor(t*this.yScale)))},ee.prototype._circlesCollide=function(t,e,i,n,o,r){var a=n-t,s=o-e,l=i+r;return l*l>a*a+s*s},ee.prototype._circleAndRectCollide=function(t,e,i,n,o,r,a){var s=(r-n)/2,l=Math.abs(t-(n+s));if(l>s+i)return !1;var c=(a-o)/2,h=Math.abs(e-(o+c));if(h>c+i)return !1;if(l<=s||h<=c)return !0;var u=l-s,p=h-c;return u*u+p*p<=i*i};var ie=t.properties.layout;function ne(e,i,n,o,r){var a=t.identity(new Float32Array(16));return i?(t.identity(a),t.scale(a,a,[1/r,1/r,1]),n||t.rotateZ(a,a,o.angle)):(t.scale(a,a,[o.width/2,-o.height/2,1]),t.translate(a,a,[1,-1,0]),t.multiply(a,a,e)),a}function oe(e,i,n,o,r){var a=t.identity(new Float32Array(16));return i?(t.multiply(a,a,e),t.scale(a,a,[r,r,1]),n||t.rotateZ(a,a,-o.angle)):(t.scale(a,a,[1,-1,1]),t.translate(a,a,[-1,-1,0]),t.scale(a,a,[2/o.width,2/o.height,1])),a}function re(e,i){var n=[e.x,e.y,0,1];fe(n,n,i);var o=n[3];return {point:new t.Point(n[0]/o,n[1]/o),signedDistanceFromCamera:o}}function ae(t,e){var i=t[0]/t[3],n=t[1]/t[3];return i>=-e[0]&&i<=e[0]&&n>=-e[1]&&n<=e[1]}function se(e,i,n,o,r,a,s,l){var c=o?e.textSizeData:e.iconSizeData,h=t.evaluateSizeForZoom(c,n.transform.zoom,ie.properties[o?"text-size":"icon-size"]),u=[256/n.width*2+1,256/n.height*2+1],p=o?e.text.dynamicLayoutVertexArray:e.icon.dynamicLayoutVertexArray;p.clear();for(var d=e.lineVertexArray,_=o?e.text.placedSymbolArray:e.icon.placedSymbolArray,f=n.transform.width/n.transform.height,m=!1,g=0;g<_.length;g++){var v=_.get(g);if(v.hidden||v.writingMode===t.WritingMode.vertical&&!m)_e(v.numGlyphs,p);else{m=!1;var y=[v.anchorX,v.anchorY,0,1];if(t.transformMat4(y,y,i),ae(y,u)){var x=.5+y[3]/n.transform.cameraToCenterDistance*.5,b=t.evaluateSizeForFeature(c,h,v),w=s?b*x:b/x,E=new t.Point(v.anchorX,v.anchorY),T=re(E,r).point,S={},I=he(v,w,!1,l,i,r,a,e.glyphOffsetArray,d,p,T,E,S,f);m=I.useVertical,(I.notEnoughRoom||m||I.needsFlipping&&he(v,w,!0,l,i,r,a,e.glyphOffsetArray,d,p,T,E,S,f).notEnoughRoom)&&_e(v.numGlyphs,p);}else _e(v.numGlyphs,p);}}o?e.text.dynamicLayoutVertexBuffer.updateData(p):e.icon.dynamicLayoutVertexBuffer.updateData(p);}function le(t,e,i,n,o,r,a,s,l,c,h,u){var p=s.glyphStartIndex+s.numGlyphs,d=s.lineStartIndex,_=s.lineStartIndex+s.lineLength,f=e.getoffsetX(s.glyphStartIndex),m=e.getoffsetX(p-1),g=pe(t*f,i,n,o,r,a,s.segment,d,_,l,c,h,u);if(!g)return null;var v=pe(t*m,i,n,o,r,a,s.segment,d,_,l,c,h,u);return v?{first:g,last:v}:null}function ce(e,i,n,o){if(e===t.WritingMode.horizontal&&Math.abs(n.y-i.y)>Math.abs(n.x-i.x)*o)return {useVertical:!0};return (e===t.WritingMode.vertical?i.y<n.y:i.x>n.x)?{needsFlipping:!0}:null}function he(e,i,n,o,r,a,s,l,c,h,u,p,d,_){var f,m=i/24,g=e.lineOffsetX*i,v=e.lineOffsetY*i;if(e.numGlyphs>1){var y=e.glyphStartIndex+e.numGlyphs,x=e.lineStartIndex,b=e.lineStartIndex+e.lineLength,w=le(m,l,g,v,n,u,p,e,c,a,d,!1);if(!w)return {notEnoughRoom:!0};var E=re(w.first.point,s).point,T=re(w.last.point,s).point;if(o&&!n){var S=ce(e.writingMode,E,T,_);if(S)return S}f=[w.first];for(var I=e.glyphStartIndex+1;I<y-1;I++)f.push(pe(m*l.getoffsetX(I),g,v,n,u,p,e.segment,x,b,c,a,d,!1));f.push(w.last);}else{if(o&&!n){var C=re(p,r).point,z=e.lineStartIndex+e.segment+1,P=new t.Point(c.getx(z),c.gety(z)),R=re(P,r),A=R.signedDistanceFromCamera>0?R.point:ue(p,P,C,1,r),L=ce(e.writingMode,C,A,_);if(L)return L}var D=pe(m*l.getoffsetX(e.glyphStartIndex),g,v,n,u,p,e.segment,e.lineStartIndex,e.lineStartIndex+e.lineLength,c,a,d,!1);if(!D)return {notEnoughRoom:!0};f=[D];}for(var M=0,k=f;M<k.length;M+=1){var B=k[M];t.addDynamicAttributes(h,B.point,B.angle);}return {}}function ue(t,e,i,n,o){var r=re(t.add(t.sub(e)._unit()),o).point,a=i.sub(r);return i.add(a._mult(n/a.mag()))}function pe(e,i,n,o,r,a,s,l,c,h,u,p,d){var _=o?e-i:e+i,f=_>0?1:-1,m=0;o&&(f*=-1,m=Math.PI),f<0&&(m+=Math.PI);for(var g=f>0?l+s:l+s+1,v=g,y=r,x=r,b=0,w=0,E=Math.abs(_);b+w<=E;){if((g+=f)<l||g>=c)return null;if(x=y,void 0===(y=p[g])){var T=new t.Point(h.getx(g),h.gety(g)),S=re(T,u);if(S.signedDistanceFromCamera>0)y=p[g]=S.point;else{var I=g-f;y=ue(0===b?a:new t.Point(h.getx(I),h.gety(I)),T,x,E-b+1,u);}}b+=w,w=x.dist(y);}var C=(E-b)/w,z=y.sub(x),P=z.mult(C)._add(x);return P._add(z._unit()._perp()._mult(n*f)),{point:P,angle:m+Math.atan2(y.y-x.y,y.x-x.x),tileDistance:d?{prevTileDistance:g-f===v?0:h.gettileUnitDistanceFromAnchor(g-f),lastSegmentViewportDistance:E-b}:null}}var de=new Float32Array([-1/0,-1/0,0,-1/0,-1/0,0,-1/0,-1/0,0,-1/0,-1/0,0]);function _e(t,e){for(var i=0;i<t;i++){var n=e.length;e.resize(n+4),e.float32.set(de,3*n);}}function fe(t,e,i){var n=e[0],o=e[1];return t[0]=i[0]*n+i[4]*o+i[12],t[1]=i[1]*n+i[5]*o+i[13],t[3]=i[3]*n+i[7]*o+i[15],t}var me=function(t,e,i){void 0===e&&(e=new ee(t.width+200,t.height+200,25)),void 0===i&&(i=new ee(t.width+200,t.height+200,25)),this.transform=t,this.grid=e,this.ignoredGrid=i,this.pitchfactor=Math.cos(t._pitch)*t.cameraToCenterDistance,this.screenRightBoundary=t.width+100,this.screenBottomBoundary=t.height+100,this.gridRightBoundary=t.width+200,this.gridBottomBoundary=t.height+200;};function ge(t,e,i){t[e+4]=i?1:0;}function ve(e,i,n){return i*(t.EXTENT/(e.tileSize*Math.pow(2,n-e.tileID.overscaledZ)))}me.prototype.placeCollisionBox=function(t,e,i,n,o){var r=this.projectAndGetPerspectiveRatio(n,t.anchorPointX,t.anchorPointY),a=i*r.perspectiveRatio,s=t.x1*a+r.point.x,l=t.y1*a+r.point.y,c=t.x2*a+r.point.x,h=t.y2*a+r.point.y;return !this.isInsideGrid(s,l,c,h)||!e&&this.grid.hitTest(s,l,c,h,o)?{box:[],offscreen:!1}:{box:[s,l,c,h],offscreen:this.isOffscreen(s,l,c,h)}},me.prototype.approximateTileDistance=function(t,e,i,n,o){var r=o?1:n/this.pitchfactor,a=t.lastSegmentViewportDistance*i;return t.prevTileDistance+a+(r-1)*a*Math.abs(Math.sin(e))},me.prototype.placeCollisionCircles=function(e,i,n,o,r,a,s,l,c,h,u,p,d){var _=[],f=this.projectAnchor(c,r.anchorX,r.anchorY),m=l/24,g=r.lineOffsetX*l,v=r.lineOffsetY*l,y=new t.Point(r.anchorX,r.anchorY),x=le(m,s,g,v,!1,re(y,h).point,y,r,a,h,{},!0),b=!1,w=!1,E=!0,T=f.perspectiveRatio*o,S=1/(o*n),I=0,C=0;x&&(I=this.approximateTileDistance(x.first.tileDistance,x.first.angle,S,f.cameraDistance,p),C=this.approximateTileDistance(x.last.tileDistance,x.last.angle,S,f.cameraDistance,p));for(var z=0;z<e.length;z+=5){var P=e[z],R=e[z+1],A=e[z+2],L=e[z+3];if(!x||L<-I||L>C)ge(e,z,!1);else{var D=this.projectPoint(c,P,R),M=A*T;if(_.length>0){var k=D.x-_[_.length-4],B=D.y-_[_.length-3];if(M*M*2>k*k+B*B)if(z+8<e.length){var O=e[z+8];if(O>-I&&O<C){ge(e,z,!1);continue}}}var F=z/5;_.push(D.x,D.y,M,F),ge(e,z,!0);var U=D.x-M,N=D.y-M,Z=D.x+M,q=D.y+M;if(E=E&&this.isOffscreen(U,N,Z,q),w=w||this.isInsideGrid(U,N,Z,q),!i&&this.grid.hitTestCircle(D.x,D.y,M,d)){if(!u)return {circles:[],offscreen:!1};b=!0;}}}return {circles:b||!w?[]:_,offscreen:E}},me.prototype.queryRenderedSymbols=function(e){if(0===e.length||0===this.grid.keysLength()&&0===this.ignoredGrid.keysLength())return {};for(var i=[],n=1/0,o=1/0,r=-1/0,a=-1/0,s=0,l=e;s<l.length;s+=1){var c=l[s],h=new t.Point(c.x+100,c.y+100);n=Math.min(n,h.x),o=Math.min(o,h.y),r=Math.max(r,h.x),a=Math.max(a,h.y),i.push(h);}for(var u={},p={},d=0,_=this.grid.query(n,o,r,a).concat(this.ignoredGrid.query(n,o,r,a));d<_.length;d+=1){var f=_[d],m=f.key;if(void 0===u[m.bucketInstanceId]&&(u[m.bucketInstanceId]={}),!u[m.bucketInstanceId][m.featureIndex]){var g=[new t.Point(f.x1,f.y1),new t.Point(f.x2,f.y1),new t.Point(f.x2,f.y2),new t.Point(f.x1,f.y2)];t.polygonIntersectsPolygon(i,g)&&(u[m.bucketInstanceId][m.featureIndex]=!0,void 0===p[m.bucketInstanceId]&&(p[m.bucketInstanceId]=[]),p[m.bucketInstanceId].push(m.featureIndex));}}return p},me.prototype.insertCollisionBox=function(t,e,i,n,o){var r={bucketInstanceId:i,featureIndex:n,collisionGroupID:o};(e?this.ignoredGrid:this.grid).insert(r,t[0],t[1],t[2],t[3]);},me.prototype.insertCollisionCircles=function(t,e,i,n,o){for(var r=e?this.ignoredGrid:this.grid,a={bucketInstanceId:i,featureIndex:n,collisionGroupID:o},s=0;s<t.length;s+=4)r.insertCircle(a,t[s],t[s+1],t[s+2]);},me.prototype.projectAnchor=function(t,e,i){var n=[e,i,0,1];return fe(n,n,t),{perspectiveRatio:.5+this.transform.cameraToCenterDistance/n[3]*.5,cameraDistance:n[3]}},me.prototype.projectPoint=function(e,i,n){var o=[i,n,0,1];return fe(o,o,e),new t.Point((o[0]/o[3]+1)/2*this.transform.width+100,(-o[1]/o[3]+1)/2*this.transform.height+100)},me.prototype.projectAndGetPerspectiveRatio=function(e,i,n){var o=[i,n,0,1];return fe(o,o,e),{point:new t.Point((o[0]/o[3]+1)/2*this.transform.width+100,(-o[1]/o[3]+1)/2*this.transform.height+100),perspectiveRatio:.5+this.transform.cameraToCenterDistance/o[3]*.5}},me.prototype.isOffscreen=function(t,e,i,n){return i<100||t>=this.screenRightBoundary||n<100||e>this.screenBottomBoundary},me.prototype.isInsideGrid=function(t,e,i,n){return i>=0&&t<this.gridRightBoundary&&n>=0&&e<this.gridBottomBoundary};var ye=function(t,e,i,n){this.opacity=t?Math.max(0,Math.min(1,t.opacity+(t.placed?e:-e))):n&&i?1:0,this.placed=i;};ye.prototype.isHidden=function(){return 0===this.opacity&&!this.placed};var xe=function(t,e,i,n,o){this.text=new ye(t?t.text:null,e,i,o),this.icon=new ye(t?t.icon:null,e,n,o);};xe.prototype.isHidden=function(){return this.text.isHidden()&&this.icon.isHidden()};var be=function(t,e,i){this.text=t,this.icon=e,this.skipFade=i;},we=function(t){this.crossSourceCollisions=t,this.maxGroupID=0,this.collisionGroups={};};we.prototype.get=function(t){if(this.crossSourceCollisions)return {ID:0,predicate:null};if(!this.collisionGroups[t]){var e=++this.maxGroupID;this.collisionGroups[t]={ID:e,predicate:function(t){return t.collisionGroupID===e}};}return this.collisionGroups[t]};var Ee=function(t,e,i){this.transform=t.clone(),this.collisionIndex=new me(this.transform),this.placements={},this.opacities={},this.stale=!1,this.fadeDuration=e,this.retainedQueryData={},this.collisionGroups=new we(i);};function Te(t,e,i){t.emplaceBack(e?1:0,i?1:0),t.emplaceBack(e?1:0,i?1:0),t.emplaceBack(e?1:0,i?1:0),t.emplaceBack(e?1:0,i?1:0);}Ee.prototype.placeLayerTile=function(e,i,n,o){var r=i.getBucket(e),a=i.latestFeatureIndex;if(r&&a&&e.id===r.layerIds[0]){var s=i.collisionBoxArray,l=r.layers[0].layout,c=Math.pow(2,this.transform.zoom-i.tileID.overscaledZ),h=i.tileSize/t.EXTENT,u=this.transform.calculatePosMatrix(i.tileID.toUnwrapped()),p=ne(u,"map"===l.get("text-pitch-alignment"),"map"===l.get("text-rotation-alignment"),this.transform,ve(i,1,this.transform.zoom)),d=ne(u,"map"===l.get("icon-pitch-alignment"),"map"===l.get("icon-rotation-alignment"),this.transform,ve(i,1,this.transform.zoom));this.retainedQueryData[r.bucketInstanceId]=new function(t,e,i,n,o){this.bucketInstanceId=t,this.featureIndex=e,this.sourceLayerIndex=i,this.bucketIndex=n,this.tileID=o;}(r.bucketInstanceId,a,r.sourceLayerIndex,r.index,i.tileID),this.placeLayerBucket(r,u,p,d,c,h,n,i.holdingForFade(),o,s);}},Ee.prototype.placeLayerBucket=function(e,i,n,o,r,a,s,l,c,h){var u=e.layers[0].layout,p=t.evaluateSizeForZoom(e.textSizeData,this.transform.zoom,t.properties.layout.properties["text-size"]),d=u.get("text-optional"),_=u.get("icon-optional"),f=this.collisionGroups.get(e.sourceID);!e.collisionArrays&&h&&e.deserializeCollisionBoxes(h);for(var m=0;m<e.symbolInstances.length;m++){var g=e.symbolInstances.get(m);if(!c[g.crossTileID]){if(l){this.placements[g.crossTileID]=new be(!1,!1,!1);continue}var v=!1,y=!1,x=!0,b=null,w=null,E=null,T=0,S=0,I=e.collisionArrays[m];I.textFeatureIndex&&(T=I.textFeatureIndex),I.textBox&&(v=(b=this.collisionIndex.placeCollisionBox(I.textBox,u.get("text-allow-overlap"),a,i,f.predicate)).box.length>0,x=x&&b.offscreen);var C=I.textCircles;if(C){var z=e.text.placedSymbolArray.get(g.horizontalPlacedTextSymbolIndex),P=t.evaluateSizeForFeature(e.textSizeData,p,z);w=this.collisionIndex.placeCollisionCircles(C,u.get("text-allow-overlap"),r,a,z,e.lineVertexArray,e.glyphOffsetArray,P,i,n,s,"map"===u.get("text-pitch-alignment"),f.predicate),v=u.get("text-allow-overlap")||w.circles.length>0,x=x&&w.offscreen;}I.iconFeatureIndex&&(S=I.iconFeatureIndex),I.iconBox&&(y=(E=this.collisionIndex.placeCollisionBox(I.iconBox,u.get("icon-allow-overlap"),a,i,f.predicate)).box.length>0,x=x&&E.offscreen);var R=d||0===g.numGlyphVertices&&0===g.numVerticalGlyphVertices,A=_||0===g.numIconVertices;R||A?A?R||(y=y&&v):v=y&&v:y=v=y&&v,v&&b&&this.collisionIndex.insertCollisionBox(b.box,u.get("text-ignore-placement"),e.bucketInstanceId,T,f.ID),y&&E&&this.collisionIndex.insertCollisionBox(E.box,u.get("icon-ignore-placement"),e.bucketInstanceId,S,f.ID),v&&w&&this.collisionIndex.insertCollisionCircles(w.circles,u.get("text-ignore-placement"),e.bucketInstanceId,T,f.ID),this.placements[g.crossTileID]=new be(v,y,x||e.justReloaded),c[g.crossTileID]=!0;}}e.justReloaded=!1;},Ee.prototype.commit=function(t,e){this.commitTime=e;var i=!1,n=t&&0!==this.fadeDuration?(this.commitTime-t.commitTime)/this.fadeDuration:1,o=t?t.opacities:{};for(var r in this.placements){var a=this.placements[r],s=o[r];s?(this.opacities[r]=new xe(s,n,a.text,a.icon),i=i||a.text!==s.text.placed||a.icon!==s.icon.placed):(this.opacities[r]=new xe(null,n,a.text,a.icon,a.skipFade),i=i||a.text||a.icon);}for(var l in o){var c=o[l];if(!this.opacities[l]){var h=new xe(c,n,!1,!1);h.isHidden()||(this.opacities[l]=h,i=i||c.text.placed||c.icon.placed);}}i?this.lastPlacementChangeTime=e:"number"!=typeof this.lastPlacementChangeTime&&(this.lastPlacementChangeTime=t?t.lastPlacementChangeTime:e);},Ee.prototype.updateLayerOpacities=function(t,e){for(var i={},n=0,o=e;n<o.length;n+=1){var r=o[n],a=r.getBucket(t);a&&r.latestFeatureIndex&&t.id===a.layerIds[0]&&this.updateBucketOpacities(a,i,r.collisionBoxArray);}},Ee.prototype.updateBucketOpacities=function(t,e,i){t.hasTextData()&&t.text.opacityVertexArray.clear(),t.hasIconData()&&t.icon.opacityVertexArray.clear(),t.hasCollisionBoxData()&&t.collisionBox.collisionVertexArray.clear(),t.hasCollisionCircleData()&&t.collisionCircle.collisionVertexArray.clear();var n=t.layers[0].layout,o=new xe(null,0,!1,!1,!0),r=n.get("text-allow-overlap"),a=n.get("icon-allow-overlap"),s=new xe(null,0,r&&(a||!t.hasIconData()||n.get("icon-optional")),a&&(r||!t.hasTextData()||n.get("text-optional")),!0);!t.collisionArrays&&i&&(t.hasCollisionBoxData()||t.hasCollisionCircleData())&&t.deserializeCollisionBoxes(i);for(var l=0;l<t.symbolInstances.length;l++){var c=t.symbolInstances.get(l),h=e[c.crossTileID],u=this.opacities[c.crossTileID];h?u=o:u||(u=s,this.opacities[c.crossTileID]=u),e[c.crossTileID]=!0;var p=c.numGlyphVertices>0||c.numVerticalGlyphVertices>0,d=c.numIconVertices>0;if(p){for(var _=Le(u.text),f=(c.numGlyphVertices+c.numVerticalGlyphVertices)/4,m=0;m<f;m++)t.text.opacityVertexArray.emplaceBack(_);t.text.placedSymbolArray.get(c.horizontalPlacedTextSymbolIndex).hidden=u.text.isHidden(),c.verticalPlacedTextSymbolIndex>=0&&(t.text.placedSymbolArray.get(c.verticalPlacedTextSymbolIndex).hidden=u.text.isHidden());}if(d){for(var g=Le(u.icon),v=0;v<c.numIconVertices/4;v++)t.icon.opacityVertexArray.emplaceBack(g);t.icon.placedSymbolArray.get(l).hidden=u.icon.isHidden();}if(t.hasCollisionBoxData()||t.hasCollisionCircleData()){var y=t.collisionArrays[l];if(y){y.textBox&&Te(t.collisionBox.collisionVertexArray,u.text.placed,!1),y.iconBox&&Te(t.collisionBox.collisionVertexArray,u.icon.placed,!1);var x=y.textCircles;if(x&&t.hasCollisionCircleData())for(var b=0;b<x.length;b+=5){var w=h||0===x[b+4];Te(t.collisionCircle.collisionVertexArray,u.text.placed,w);}}}}t.sortFeatures(this.transform.angle),this.retainedQueryData[t.bucketInstanceId]&&(this.retainedQueryData[t.bucketInstanceId].featureSortOrder=t.featureSortOrder),t.hasTextData()&&t.text.opacityVertexBuffer&&t.text.opacityVertexBuffer.updateData(t.text.opacityVertexArray),t.hasIconData()&&t.icon.opacityVertexBuffer&&t.icon.opacityVertexBuffer.updateData(t.icon.opacityVertexArray),t.hasCollisionBoxData()&&t.collisionBox.collisionVertexBuffer&&t.collisionBox.collisionVertexBuffer.updateData(t.collisionBox.collisionVertexArray),t.hasCollisionCircleData()&&t.collisionCircle.collisionVertexBuffer&&t.collisionCircle.collisionVertexBuffer.updateData(t.collisionCircle.collisionVertexArray);},Ee.prototype.symbolFadeChange=function(t){return 0===this.fadeDuration?1:(t-this.commitTime)/this.fadeDuration},Ee.prototype.hasTransitions=function(t){return this.stale||t-this.lastPlacementChangeTime<this.fadeDuration},Ee.prototype.stillRecent=function(t){return "undefined"!==this.commitTime&&this.commitTime+this.fadeDuration>t},Ee.prototype.setStale=function(){this.stale=!0;};var Se=Math.pow(2,25),Ie=Math.pow(2,24),Ce=Math.pow(2,17),ze=Math.pow(2,16),Pe=Math.pow(2,9),Re=Math.pow(2,8),Ae=Math.pow(2,1);function Le(t){if(0===t.opacity&&!t.placed)return 0;if(1===t.opacity&&t.placed)return 4294967295;var e=t.placed?1:0,i=Math.floor(127*t.opacity);return i*Se+e*Ie+i*Ce+e*ze+i*Pe+e*Re+i*Ae+e}var De=function(){this._currentTileIndex=0,this._seenCrossTileIDs={};};De.prototype.continuePlacement=function(t,e,i,n,o){for(;this._currentTileIndex<t.length;){var r=t[this._currentTileIndex];if(e.placeLayerTile(n,r,i,this._seenCrossTileIDs),this._currentTileIndex++,o())return !0}};var Me=function(t,e,i,n,o,r){this.placement=new Ee(t,o,r),this._currentPlacementIndex=e.length-1,this._forceFullPlacement=i,this._showCollisionBoxes=n,this._done=!1;};Me.prototype.isDone=function(){return this._done},Me.prototype.continuePlacement=function(e,i,n){for(var o=this,r=t.browser.now(),a=function(){var e=t.browser.now()-r;return !o._forceFullPlacement&&e>2};this._currentPlacementIndex>=0;){var s=i[e[o._currentPlacementIndex]],l=o.placement.collisionIndex.transform.zoom;if("symbol"===s.type&&(!s.minzoom||s.minzoom<=l)&&(!s.maxzoom||s.maxzoom>l)){if(o._inProgressLayer||(o._inProgressLayer=new De),o._inProgressLayer.continuePlacement(n[s.source],o.placement,o._showCollisionBoxes,s,a))return;delete o._inProgressLayer;}o._currentPlacementIndex--;}this._done=!0;},Me.prototype.commit=function(t,e){return this.placement.commit(t,e),this.placement};var ke=512/t.EXTENT/2,Be=function(t,e,i){this.tileID=t,this.indexedSymbolInstances={},this.bucketInstanceId=i;for(var n=0;n<e.length;n++){var o=e.get(n),r=o.key;this.indexedSymbolInstances[r]||(this.indexedSymbolInstances[r]=[]),this.indexedSymbolInstances[r].push({crossTileID:o.crossTileID,coord:this.getScaledCoordinates(o,t)});}};Be.prototype.getScaledCoordinates=function(e,i){var n=i.canonical.z-this.tileID.canonical.z,o=ke/Math.pow(2,n);return {x:Math.floor((i.canonical.x*t.EXTENT+e.anchorX)*o),y:Math.floor((i.canonical.y*t.EXTENT+e.anchorY)*o)}},Be.prototype.findMatches=function(t,e,i){for(var n=this.tileID.canonical.z<e.canonical.z?1:Math.pow(2,this.tileID.canonical.z-e.canonical.z),o=0;o<t.length;o++){var r=t.get(o);if(!r.crossTileID){var a=this.indexedSymbolInstances[r.key];if(a)for(var s=this.getScaledCoordinates(r,e),l=0,c=a;l<c.length;l+=1){var h=c[l];if(Math.abs(h.coord.x-s.x)<=n&&Math.abs(h.coord.y-s.y)<=n&&!i[h.crossTileID]){i[h.crossTileID]=!0,r.crossTileID=h.crossTileID;break}}}}};var Oe=function(){this.maxCrossTileID=0;};Oe.prototype.generate=function(){return ++this.maxCrossTileID};var Fe=function(){this.indexes={},this.usedCrossTileIDs={},this.lng=0;};Fe.prototype.handleWrapJump=function(t){var e=Math.round((t-this.lng)/360);if(0!==e)for(var i in this.indexes){var n=this.indexes[i],o={};for(var r in n){var a=n[r];a.tileID=a.tileID.unwrapTo(a.tileID.wrap+e),o[a.tileID.key]=a;}this.indexes[i]=o;}this.lng=t;},Fe.prototype.addBucket=function(t,e,i){if(this.indexes[t.overscaledZ]&&this.indexes[t.overscaledZ][t.key]){if(this.indexes[t.overscaledZ][t.key].bucketInstanceId===e.bucketInstanceId)return !1;this.removeBucketCrossTileIDs(t.overscaledZ,this.indexes[t.overscaledZ][t.key]);}for(var n=0;n<e.symbolInstances.length;n++){e.symbolInstances.get(n).crossTileID=0;}this.usedCrossTileIDs[t.overscaledZ]||(this.usedCrossTileIDs[t.overscaledZ]={});var o=this.usedCrossTileIDs[t.overscaledZ];for(var r in this.indexes){var a=this.indexes[r];if(Number(r)>t.overscaledZ)for(var s in a){var l=a[s];l.tileID.isChildOf(t)&&l.findMatches(e.symbolInstances,t,o);}else{var c=a[t.scaledTo(Number(r)).key];c&&c.findMatches(e.symbolInstances,t,o);}}for(var h=0;h<e.symbolInstances.length;h++){var u=e.symbolInstances.get(h);u.crossTileID||(u.crossTileID=i.generate(),o[u.crossTileID]=!0);}return void 0===this.indexes[t.overscaledZ]&&(this.indexes[t.overscaledZ]={}),this.indexes[t.overscaledZ][t.key]=new Be(t,e.symbolInstances,e.bucketInstanceId),!0},Fe.prototype.removeBucketCrossTileIDs=function(t,e){for(var i in e.indexedSymbolInstances)for(var n=0,o=e.indexedSymbolInstances[i];n<o.length;n+=1){var r=o[n];delete this.usedCrossTileIDs[t][r.crossTileID];}},Fe.prototype.removeStaleBuckets=function(t){var e=!1;for(var i in this.indexes){var n=this.indexes[i];for(var o in n)t[n[o].bucketInstanceId]||(this.removeBucketCrossTileIDs(i,n[o]),delete n[o],e=!0);}return e};var Ue=function(){this.layerIndexes={},this.crossTileIDs=new Oe,this.maxBucketInstanceId=0,this.bucketsInCurrentPlacement={};};Ue.prototype.addLayer=function(t,e,i){var n=this.layerIndexes[t.id];void 0===n&&(n=this.layerIndexes[t.id]=new Fe);var o=!1,r={};n.handleWrapJump(i);for(var a=0,s=e;a<s.length;a+=1){var l=s[a],c=l.getBucket(t);c&&t.id===c.layerIds[0]&&(c.bucketInstanceId||(c.bucketInstanceId=++this.maxBucketInstanceId),n.addBucket(l.tileID,c,this.crossTileIDs)&&(o=!0),r[c.bucketInstanceId]=!0);}return n.removeStaleBuckets(r)&&(o=!0),o},Ue.prototype.pruneUnusedLayers=function(t){var e={};for(var i in t.forEach(function(t){e[t]=!0;}),this.layerIndexes)e[i]||delete this.layerIndexes[i];};var Ne=function(e,i){return t.emitValidationErrors(e,i&&i.filter(function(t){return "source.canvas"!==t.identifier}))},Ze=t.pick(Wt,["addLayer","removeLayer","setPaintProperty","setLayoutProperty","setFilter","addSource","removeSource","setLayerZoomRange","setLight","setTransition","setGeoJSONSourceData"]),qe=t.pick(Wt,["setCenter","setZoom","setBearing","setPitch"]),Ve=function(e){function i(n,o){var r=this;void 0===o&&(o={}),e.call(this),this.map=n,this.dispatcher=new O((qt||(qt=new Vt),qt),this),this.imageManager=new I,this.glyphManager=new L(n._transformRequest,o.localIdeographFontFamily),this.lineAtlas=new B(256,512),this.crossTileSymbolIndex=new Ue,this._layers={},this._order=[],this.sourceCaches={},this.zoomHistory=new t.ZoomHistory,this._loaded=!1,this._resetUpdates();var a=this;this._rtlTextPluginCallback=i.registerForPluginAvailability(function(t){for(var e in a.dispatcher.broadcast("loadRTLTextPlugin",t.pluginURL,t.completionCallback),a.sourceCaches)a.sourceCaches[e].reload();}),this.on("data",function(t){if("source"===t.dataType&&"metadata"===t.sourceDataType){var e=r.sourceCaches[t.sourceId];if(e){var i=e.getSource();if(i&&i.vectorLayerIds)for(var n in r._layers){var o=r._layers[n];o.source===i.id&&r._validateLayer(o);}}}});}return e&&(i.__proto__=e),i.prototype=Object.create(e&&e.prototype),i.prototype.constructor=i,i.prototype.loadURL=function(e,i){var n=this;void 0===i&&(i={}),this.fire(new t.Event("dataloading",{dataType:"style"}));var o="boolean"==typeof i.validate?i.validate:!_(e);e=function(t,e){if(!_(t))return t;var i=b(t);return i.path="/styles/v1"+i.path,d(i,e)}(e,i.accessToken);var r=this.map._transformRequest(e,t.ResourceType.Style);this._request=t.getJSON(r,function(e,i){n._request=null,e?n.fire(new t.ErrorEvent(e)):i&&n._load(i,o);});},i.prototype.loadJSON=function(e,i){var n=this;void 0===i&&(i={}),this.fire(new t.Event("dataloading",{dataType:"style"})),this._request=t.browser.frame(function(){n._request=null,n._load(e,!1!==i.validate);});},i.prototype._load=function(e,i){var n=this;if(!i||!Ne(this,t.validateStyle(e))){for(var o in this._loaded=!0,this.stylesheet=e,e.sources)n.addSource(o,e.sources[o],{validate:!1});e.sprite?this._spriteRequest=function(e,i,n){var o,r,a,s=t.browser.devicePixelRatio>1?"@2x":"",l=t.getJSON(i(g(e,s,".json"),t.ResourceType.SpriteJSON),function(t,e){l=null,a||(a=t,o=e,h());}),c=t.getImage(i(g(e,s,".png"),t.ResourceType.SpriteImage),function(t,e){c=null,a||(a=t,r=e,h());});function h(){if(a)n(a);else if(o&&r){var e=t.browser.getImageData(r),i={};for(var s in o){var l=o[s],c=l.width,h=l.height,u=l.x,p=l.y,d=l.sdf,_=l.pixelRatio,f=new t.RGBAImage({width:c,height:h});t.RGBAImage.copy(e,f,{x:u,y:p},{x:0,y:0},{width:c,height:h}),i[s]={data:f,pixelRatio:_,sdf:d};}n(null,i);}}return {cancel:function(){l&&(l.cancel(),l=null),c&&(c.cancel(),c=null);}}}(e.sprite,this.map._transformRequest,function(e,i){if(n._spriteRequest=null,e)n.fire(new t.ErrorEvent(e));else if(i)for(var o in i)n.imageManager.addImage(o,i[o]);n.imageManager.setLoaded(!0),n.fire(new t.Event("data",{dataType:"style"}));}):this.imageManager.setLoaded(!0),this.glyphManager.setURL(e.glyphs);var r=Gt(this.stylesheet.layers);this._order=r.map(function(t){return t.id}),this._layers={};for(var a=0,s=r;a<s.length;a+=1){var l=s[a];(l=t.createStyleLayer(l)).setEventedParent(n,{layer:{id:l.id}}),n._layers[l.id]=l;}this.dispatcher.broadcast("setLayers",this._serializeLayers(this._order)),this.light=new k(this.stylesheet.light),this.fire(new t.Event("data",{dataType:"style"})),this.fire(new t.Event("style.load"));}},i.prototype._validateLayer=function(e){var i=this.sourceCaches[e.source];if(i){var n=e.sourceLayer;if(n){var o=i.getSource();("geojson"===o.type||o.vectorLayerIds&&-1===o.vectorLayerIds.indexOf(n))&&this.fire(new t.ErrorEvent(new Error('Source layer "'+n+'" does not exist on source "'+o.id+'" as specified by style layer "'+e.id+'"')));}}},i.prototype.loaded=function(){if(!this._loaded)return !1;if(Object.keys(this._updatedSources).length)return !1;for(var t in this.sourceCaches)if(!this.sourceCaches[t].loaded())return !1;return !!this.imageManager.isLoaded()},i.prototype._serializeLayers=function(t){var e=this;return t.map(function(t){return e._layers[t].serialize()})},i.prototype.hasTransitions=function(){if(this.light&&this.light.hasTransition())return !0;for(var t in this.sourceCaches)if(this.sourceCaches[t].hasTransition())return !0;for(var e in this._layers)if(this._layers[e].hasTransition())return !0;return !1},i.prototype._checkLoaded=function(){if(!this._loaded)throw new Error("Style is not done loading")},i.prototype.update=function(e){if(this._loaded){if(this._changed){var i=Object.keys(this._updatedLayers),n=Object.keys(this._removedLayers);for(var o in(i.length||n.length)&&this._updateWorkerLayers(i,n),this._updatedSources){var r=this._updatedSources[o];"reload"===r?this._reloadSource(o):"clear"===r&&this._clearSource(o);}for(var a in this._updatedPaintProps)this._layers[a].updateTransitions(e);this.light.updateTransitions(e),this._resetUpdates(),this.fire(new t.Event("data",{dataType:"style"}));}for(var s in this.sourceCaches)this.sourceCaches[s].used=!1;for(var l=0,c=this._order;l<c.length;l+=1){var h=c[l],u=this._layers[h];u.recalculate(e),!u.isHidden(e.zoom)&&u.source&&(this.sourceCaches[u.source].used=!0);}this.light.recalculate(e),this.z=e.zoom;}},i.prototype._updateWorkerLayers=function(t,e){this.dispatcher.broadcast("updateLayers",{layers:this._serializeLayers(t),removedIds:e});},i.prototype._resetUpdates=function(){this._changed=!1,this._updatedLayers={},this._removedLayers={},this._updatedSources={},this._updatedPaintProps={};},i.prototype.setState=function(e){var i=this;if(this._checkLoaded(),Ne(this,t.validateStyle(e)))return !1;(e=t.clone(e)).layers=Gt(e.layers);var n=te(this.serialize(),e).filter(function(t){return !(t.command in qe)});if(0===n.length)return !1;var o=n.filter(function(t){return !(t.command in Ze)});if(o.length>0)throw new Error("Unimplemented: "+o.map(function(t){return t.command}).join(", ")+".");return n.forEach(function(t){"setTransition"!==t.command&&i[t.command].apply(i,t.args);}),this.stylesheet=e,!0},i.prototype.addImage=function(e,i){if(this.getImage(e))return this.fire(new t.ErrorEvent(new Error("An image with this name already exists.")));this.imageManager.addImage(e,i),this.fire(new t.Event("data",{dataType:"style"}));},i.prototype.getImage=function(t){return this.imageManager.getImage(t)},i.prototype.removeImage=function(e){if(!this.getImage(e))return this.fire(new t.ErrorEvent(new Error("No image with this name exists.")));this.imageManager.removeImage(e),this.fire(new t.Event("data",{dataType:"style"}));},i.prototype.listImages=function(){return this._checkLoaded(),this.imageManager.listImages()},i.prototype.addSource=function(e,i,n){var o=this;if(this._checkLoaded(),void 0!==this.sourceCaches[e])throw new Error("There is already a source with this ID");if(!i.type)throw new Error("The type property must be defined, but the only the following properties were given: "+Object.keys(i).join(", ")+".");if(!(["vector","raster","geojson","video","image"].indexOf(i.type)>=0)||!this._validate(t.validateStyle.source,"sources."+e,i,null,n)){this.map&&this.map._collectResourceTiming&&(i.collectResourceTiming=!0);var r=this.sourceCaches[e]=new Ot(e,i,this.dispatcher);r.style=this,r.setEventedParent(this,function(){return {isSourceLoaded:o.loaded(),source:r.serialize(),sourceId:e}}),r.onAdd(this.map),this._changed=!0;}},i.prototype.removeSource=function(e){if(this._checkLoaded(),void 0===this.sourceCaches[e])throw new Error("There is no source with this ID");for(var i in this._layers)if(this._layers[i].source===e)return this.fire(new t.ErrorEvent(new Error('Source "'+e+'" cannot be removed while layer "'+i+'" is using it.')));var n=this.sourceCaches[e];delete this.sourceCaches[e],delete this._updatedSources[e],n.fire(new t.Event("data",{sourceDataType:"metadata",dataType:"source",sourceId:e})),n.setEventedParent(null),n.clearTiles(),n.onRemove&&n.onRemove(this.map),this._changed=!0;},i.prototype.setGeoJSONSourceData=function(t,e){this._checkLoaded(),this.sourceCaches[t].getSource().setData(e),this._changed=!0;},i.prototype.getSource=function(t){return this.sourceCaches[t]&&this.sourceCaches[t].getSource()},i.prototype.addLayer=function(e,i,n){this._checkLoaded();var o=e.id;if(this.getLayer(o))this.fire(new t.ErrorEvent(new Error('Layer with id "'+o+'" already exists on this map')));else if("object"==typeof e.source&&(this.addSource(o,e.source),e=t.clone(e),e=t.extend(e,{source:o})),!this._validate(t.validateStyle.layer,"layers."+o,e,{arrayIndex:-1},n)){var r=t.createStyleLayer(e);this._validateLayer(r),r.setEventedParent(this,{layer:{id:o}});var a=i?this._order.indexOf(i):this._order.length;if(i&&-1===a)this.fire(new t.ErrorEvent(new Error('Layer with id "'+i+'" does not exist on this map.')));else{if(this._order.splice(a,0,o),this._layerOrderChanged=!0,this._layers[o]=r,this._removedLayers[o]&&r.source){var s=this._removedLayers[o];delete this._removedLayers[o],s.type!==r.type?this._updatedSources[r.source]="clear":(this._updatedSources[r.source]="reload",this.sourceCaches[r.source].pause());}this._updateLayer(r);}}},i.prototype.moveLayer=function(e,i){if(this._checkLoaded(),this._changed=!0,this._layers[e]){if(e!==i){var n=this._order.indexOf(e);this._order.splice(n,1);var o=i?this._order.indexOf(i):this._order.length;i&&-1===o?this.fire(new t.ErrorEvent(new Error('Layer with id "'+i+'" does not exist on this map.'))):(this._order.splice(o,0,e),this._layerOrderChanged=!0);}}else this.fire(new t.ErrorEvent(new Error("The layer '"+e+"' does not exist in the map's style and cannot be moved.")));},i.prototype.removeLayer=function(e){this._checkLoaded();var i=this._layers[e];if(i){i.setEventedParent(null);var n=this._order.indexOf(e);this._order.splice(n,1),this._layerOrderChanged=!0,this._changed=!0,this._removedLayers[e]=i,delete this._layers[e],delete this._updatedLayers[e],delete this._updatedPaintProps[e];}else this.fire(new t.ErrorEvent(new Error("The layer '"+e+"' does not exist in the map's style and cannot be removed.")));},i.prototype.getLayer=function(t){return this._layers[t]},i.prototype.setLayerZoomRange=function(e,i,n){this._checkLoaded();var o=this.getLayer(e);o?o.minzoom===i&&o.maxzoom===n||(null!=i&&(o.minzoom=i),null!=n&&(o.maxzoom=n),this._updateLayer(o)):this.fire(new t.ErrorEvent(new Error("The layer '"+e+"' does not exist in the map's style and cannot have zoom extent.")));},i.prototype.setFilter=function(e,i){this._checkLoaded();var n=this.getLayer(e);if(n){if(!t.deepEqual(n.filter,i))return null==i?(n.filter=void 0,void this._updateLayer(n)):void(this._validate(t.validateStyle.filter,"layers."+n.id+".filter",i)||(n.filter=t.clone(i),this._updateLayer(n)))}else this.fire(new t.ErrorEvent(new Error("The layer '"+e+"' does not exist in the map's style and cannot be filtered.")));},i.prototype.getFilter=function(e){return t.clone(this.getLayer(e).filter)},i.prototype.setLayoutProperty=function(e,i,n){this._checkLoaded();var o=this.getLayer(e);o?t.deepEqual(o.getLayoutProperty(i),n)||(o.setLayoutProperty(i,n),this._updateLayer(o)):this.fire(new t.ErrorEvent(new Error("The layer '"+e+"' does not exist in the map's style and cannot be styled.")));},i.prototype.getLayoutProperty=function(t,e){return this.getLayer(t).getLayoutProperty(e)},i.prototype.setPaintProperty=function(e,i,n){this._checkLoaded();var o=this.getLayer(e);o?t.deepEqual(o.getPaintProperty(i),n)||(o.setPaintProperty(i,n)&&this._updateLayer(o),this._changed=!0,this._updatedPaintProps[e]=!0):this.fire(new t.ErrorEvent(new Error("The layer '"+e+"' does not exist in the map's style and cannot be styled.")));},i.prototype.getPaintProperty=function(t,e){return this.getLayer(t).getPaintProperty(e)},i.prototype.setFeatureState=function(e,i){this._checkLoaded();var n=e.source,o=e.sourceLayer,r=this.sourceCaches[n],a=parseInt(e.id,10);void 0!==r?"vector"!==r.getSource().type||o?isNaN(a)||a<0?this.fire(new t.ErrorEvent(new Error("The feature id parameter must be provided and non-negative."))):r.setFeatureState(o,a,i):this.fire(new t.ErrorEvent(new Error("The sourceLayer parameter must be provided for vector source types."))):this.fire(new t.ErrorEvent(new Error("The source '"+n+"' does not exist in the map's style.")));},i.prototype.getFeatureState=function(e){this._checkLoaded();var i=e.source,n=e.sourceLayer,o=this.sourceCaches[i],r=parseInt(e.id,10);if(void 0!==o)if("vector"!==o.getSource().type||n){if(!(isNaN(r)||r<0))return o.getFeatureState(n,r);this.fire(new t.ErrorEvent(new Error("The feature id parameter must be provided and non-negative.")));}else this.fire(new t.ErrorEvent(new Error("The sourceLayer parameter must be provided for vector source types.")));else this.fire(new t.ErrorEvent(new Error("The source '"+i+"' does not exist in the map's style.")));},i.prototype.getTransition=function(){return t.extend({duration:300,delay:0},this.stylesheet&&this.stylesheet.transition)},i.prototype.serialize=function(){var e=this;return t.filterObject({version:this.stylesheet.version,name:this.stylesheet.name,metadata:this.stylesheet.metadata,light:this.stylesheet.light,center:this.stylesheet.center,zoom:this.stylesheet.zoom,bearing:this.stylesheet.bearing,pitch:this.stylesheet.pitch,sprite:this.stylesheet.sprite,glyphs:this.stylesheet.glyphs,transition:this.stylesheet.transition,sources:t.mapObject(this.sourceCaches,function(t){return t.serialize()}),layers:this._order.map(function(t){return e._layers[t].serialize()})},function(t){return void 0!==t})},i.prototype._updateLayer=function(t){this._updatedLayers[t.id]=!0,t.source&&!this._updatedSources[t.source]&&(this._updatedSources[t.source]="reload",this.sourceCaches[t.source].pause()),this._changed=!0;},i.prototype._flattenRenderedFeatures=function(t){for(var e=[],i=this._order.length-1;i>=0;i--)for(var n=this._order[i],o=0,r=t;o<r.length;o+=1){var a=r[o][n];if(a)for(var s=0,l=a;s<l.length;s+=1){var c=l[s];e.push(c);}}return e},i.prototype.queryRenderedFeatures=function(e,i,n){i&&i.filter&&this._validate(t.validateStyle.filter,"queryRenderedFeatures.filter",i.filter);var o={};if(i&&i.layers){if(!Array.isArray(i.layers))return this.fire(new t.ErrorEvent(new Error("parameters.layers must be an Array."))),[];for(var r=0,a=i.layers;r<a.length;r+=1){var s=a[r],l=this._layers[s];if(!l)return this.fire(new t.ErrorEvent(new Error("The layer '"+s+"' does not exist in the map's style and cannot be queried for features."))),[];o[l.source]=!0;}}var c=[],h=e.map(function(t){return n.pointCoordinate(t)});for(var u in this.sourceCaches)i.layers&&!o[u]||c.push(J(this.sourceCaches[u],this._layers,h,i,n));return this.placement&&c.push(function(t,e,i,n,o,r){for(var a={},s=o.queryRenderedSymbols(i),l=[],c=0,h=Object.keys(s).map(Number);c<h.length;c+=1){var u=h[c];l.push(r[u]);}l.sort(Q);for(var p=function(){var e=_[d],i=e.featureIndex.lookupSymbolFeatures(s[e.bucketInstanceId],e.bucketIndex,e.sourceLayerIndex,n.filter,n.layers,t);for(var o in i){var r=a[o]=a[o]||[],l=i[o];l.sort(function(t,i){var n=e.featureSortOrder;if(n){var o=n.indexOf(t.featureIndex);return n.indexOf(i.featureIndex)-o}return i.featureIndex-t.featureIndex});for(var c=0,h=l;c<h.length;c+=1){var u=h[c];r.push(u.feature);}}},d=0,_=l;d<_.length;d+=1)p();var f=function(i){a[i].forEach(function(n){var o=t[i],r=e[o.source].getFeatureState(n.layer["source-layer"],n.id);n.source=n.layer.source,n.layer["source-layer"]&&(n.sourceLayer=n.layer["source-layer"]),n.state=r;});};for(var m in a)f(m);return a}(this._layers,this.sourceCaches,e,i,this.placement.collisionIndex,this.placement.retainedQueryData)),this._flattenRenderedFeatures(c)},i.prototype.querySourceFeatures=function(e,i){i&&i.filter&&this._validate(t.validateStyle.filter,"querySourceFeatures.filter",i.filter);var n=this.sourceCaches[e];return n?function(t,e){for(var i=t.getRenderableIds().map(function(e){return t.getTileByID(e)}),n=[],o={},r=0;r<i.length;r++){var a=i[r],s=a.tileID.canonical.key;o[s]||(o[s]=!0,a.querySourceFeatures(n,e));}return n}(n,i):[]},i.prototype.addSourceType=function(t,e,n){return i.getSourceType(t)?n(new Error('A source type called "'+t+'" already exists.')):(i.setSourceType(t,e),e.workerSourceURL?void this.dispatcher.broadcast("loadWorkerSource",{name:t,url:e.workerSourceURL},n):n(null,null))},i.prototype.getLight=function(){return this.light.getLight()},i.prototype.setLight=function(e){this._checkLoaded();var i=this.light.getLight(),n=!1;for(var o in e)if(!t.deepEqual(e[o],i[o])){n=!0;break}if(n){var r={now:t.browser.now(),transition:t.extend({duration:300,delay:0},this.stylesheet.transition)};this.light.setLight(e),this.light.updateTransitions(r);}},i.prototype._validate=function(e,i,n,o,r){return (!r||!1!==r.validate)&&Ne(this,e.call(t.validateStyle,t.extend({key:i,style:this.serialize(),value:n,styleSpec:t.styleSpec},o)))},i.prototype._remove=function(){for(var e in this._request&&(this._request.cancel(),this._request=null),this._spriteRequest&&(this._spriteRequest.cancel(),this._spriteRequest=null),t.evented.off("pluginAvailable",this._rtlTextPluginCallback),this.sourceCaches)this.sourceCaches[e].clearTiles();this.dispatcher.remove();},i.prototype._clearSource=function(t){this.sourceCaches[t].clearTiles();},i.prototype._reloadSource=function(t){this.sourceCaches[t].resume(),this.sourceCaches[t].reload();},i.prototype._updateSources=function(t){for(var e in this.sourceCaches)this.sourceCaches[e].update(t);},i.prototype._generateCollisionBoxes=function(){for(var t in this.sourceCaches)this._reloadSource(t);},i.prototype._updatePlacement=function(e,i,n,o){for(var r=!1,a=!1,s={},l=0,c=this._order;l<c.length;l+=1){var h=c[l],u=this._layers[h];if("symbol"===u.type){if(!s[u.source]){var p=this.sourceCaches[u.source];s[u.source]=p.getRenderableIds(!0).map(function(t){return p.getTileByID(t)}).sort(function(t,e){return e.tileID.overscaledZ-t.tileID.overscaledZ||(t.tileID.isLessThan(e.tileID)?-1:1)});}var d=this.crossTileSymbolIndex.addLayer(u,s[u.source],e.center.lng);r=r||d;}}this.crossTileSymbolIndex.pruneUnusedLayers(this._order);var _=this._layerOrderChanged;if((_||!this.pauseablePlacement||this.pauseablePlacement.isDone()&&!this.placement.stillRecent(t.browser.now()))&&(this.pauseablePlacement=new Me(e,this._order,_,i,n,o),this._layerOrderChanged=!1),this.pauseablePlacement.isDone()?this.placement.setStale():(this.pauseablePlacement.continuePlacement(this._order,this._layers,s),this.pauseablePlacement.isDone()&&(this.placement=this.pauseablePlacement.commit(this.placement,t.browser.now()),a=!0),r&&this.pauseablePlacement.placement.setStale()),a||r)for(var f=0,m=this._order;f<m.length;f+=1){var g=m[f],v=this._layers[g];"symbol"===v.type&&this.placement.updateLayerOpacities(v,s[v.source]);}return !this.pauseablePlacement.isDone()||this.placement.hasTransitions(t.browser.now())},i.prototype._releaseSymbolFadeTiles=function(){for(var t in this.sourceCaches)this.sourceCaches[t].releaseSymbolFadeTiles();},i.prototype.getImages=function(t,e,i){this.imageManager.getImages(e.icons,i);},i.prototype.getGlyphs=function(t,e,i){this.glyphManager.getGlyphs(e.stacks,i);},i}(t.Evented);Ve.getSourceType=function(t){return K[t]},Ve.setSourceType=function(t,e){K[t]=e;},Ve.registerForPluginAvailability=t.registerForPluginAvailability;var je=t.createLayout([{name:"a_pos",type:"Int16",components:2}]),Ge={prelude:{fragmentSource:"#ifdef GL_ES\nprecision mediump float;\n#else\n\n#if !defined(lowp)\n#define lowp\n#endif\n\n#if !defined(mediump)\n#define mediump\n#endif\n\n#if !defined(highp)\n#define highp\n#endif\n\n#endif\n",vertexSource:"#ifdef GL_ES\nprecision highp float;\n#else\n\n#if !defined(lowp)\n#define lowp\n#endif\n\n#if !defined(mediump)\n#define mediump\n#endif\n\n#if !defined(highp)\n#define highp\n#endif\n\n#endif\n\n// Unpack a pair of values that have been packed into a single float.\n// The packed values are assumed to be 8-bit unsigned integers, and are\n// packed like so:\n// packedValue = floor(input[0]) * 256 + input[1],\nvec2 unpack_float(const float packedValue) {\n    int packedIntValue = int(packedValue);\n    int v0 = packedIntValue / 256;\n    return vec2(v0, packedIntValue - v0 * 256);\n}\n\nvec2 unpack_opacity(const float packedOpacity) {\n    int intOpacity = int(packedOpacity) / 2;\n    return vec2(float(intOpacity) / 127.0, mod(packedOpacity, 2.0));\n}\n\n// To minimize the number of attributes needed, we encode a 4-component\n// color into a pair of floats (i.e. a vec2) as follows:\n// [ floor(color.r * 255) * 256 + color.g * 255,\n//   floor(color.b * 255) * 256 + color.g * 255 ]\nvec4 decode_color(const vec2 encodedColor) {\n    return vec4(\n        unpack_float(encodedColor[0]) / 255.0,\n        unpack_float(encodedColor[1]) / 255.0\n    );\n}\n\n// Unpack a pair of paint values and interpolate between them.\nfloat unpack_mix_vec2(const vec2 packedValue, const float t) {\n    return mix(packedValue[0], packedValue[1], t);\n}\n\n// Unpack a pair of paint values and interpolate between them.\nvec4 unpack_mix_color(const vec4 packedColors, const float t) {\n    vec4 minColor = decode_color(vec2(packedColors[0], packedColors[1]));\n    vec4 maxColor = decode_color(vec2(packedColors[2], packedColors[3]));\n    return mix(minColor, maxColor, t);\n}\n\n// The offset depends on how many pixels are between the world origin and the edge of the tile:\n// vec2 offset = mod(pixel_coord, size)\n//\n// At high zoom levels there are a ton of pixels between the world origin and the edge of the tile.\n// The glsl spec only guarantees 16 bits of precision for highp floats. We need more than that.\n//\n// The pixel_coord is passed in as two 16 bit values:\n// pixel_coord_upper = floor(pixel_coord / 2^16)\n// pixel_coord_lower = mod(pixel_coord, 2^16)\n//\n// The offset is calculated in a series of steps that should preserve this precision:\nvec2 get_pattern_pos(const vec2 pixel_coord_upper, const vec2 pixel_coord_lower,\n    const vec2 pattern_size, const float tile_units_to_pixels, const vec2 pos) {\n\n    vec2 offset = mod(mod(mod(pixel_coord_upper, pattern_size) * 256.0, pattern_size) * 256.0 + pixel_coord_lower, pattern_size);\n    return (tile_units_to_pixels * pos + offset) / pattern_size;\n}\n"},background:{fragmentSource:"uniform vec4 u_color;\nuniform float u_opacity;\n\nvoid main() {\n    gl_FragColor = u_color * u_opacity;\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"attribute vec2 a_pos;\n\nuniform mat4 u_matrix;\n\nvoid main() {\n    gl_Position = u_matrix * vec4(a_pos, 0, 1);\n}\n"},backgroundPattern:{fragmentSource:"uniform vec2 u_pattern_tl_a;\nuniform vec2 u_pattern_br_a;\nuniform vec2 u_pattern_tl_b;\nuniform vec2 u_pattern_br_b;\nuniform vec2 u_texsize;\nuniform float u_mix;\nuniform float u_opacity;\n\nuniform sampler2D u_image;\n\nvarying vec2 v_pos_a;\nvarying vec2 v_pos_b;\n\nvoid main() {\n    vec2 imagecoord = mod(v_pos_a, 1.0);\n    vec2 pos = mix(u_pattern_tl_a / u_texsize, u_pattern_br_a / u_texsize, imagecoord);\n    vec4 color1 = texture2D(u_image, pos);\n\n    vec2 imagecoord_b = mod(v_pos_b, 1.0);\n    vec2 pos2 = mix(u_pattern_tl_b / u_texsize, u_pattern_br_b / u_texsize, imagecoord_b);\n    vec4 color2 = texture2D(u_image, pos2);\n\n    gl_FragColor = mix(color1, color2, u_mix) * u_opacity;\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"uniform mat4 u_matrix;\nuniform vec2 u_pattern_size_a;\nuniform vec2 u_pattern_size_b;\nuniform vec2 u_pixel_coord_upper;\nuniform vec2 u_pixel_coord_lower;\nuniform float u_scale_a;\nuniform float u_scale_b;\nuniform float u_tile_units_to_pixels;\n\nattribute vec2 a_pos;\n\nvarying vec2 v_pos_a;\nvarying vec2 v_pos_b;\n\nvoid main() {\n    gl_Position = u_matrix * vec4(a_pos, 0, 1);\n\n    v_pos_a = get_pattern_pos(u_pixel_coord_upper, u_pixel_coord_lower, u_scale_a * u_pattern_size_a, u_tile_units_to_pixels, a_pos);\n    v_pos_b = get_pattern_pos(u_pixel_coord_upper, u_pixel_coord_lower, u_scale_b * u_pattern_size_b, u_tile_units_to_pixels, a_pos);\n}\n"},circle:{fragmentSource:"#pragma mapbox: define highp vec4 color\n#pragma mapbox: define mediump float radius\n#pragma mapbox: define lowp float blur\n#pragma mapbox: define lowp float opacity\n#pragma mapbox: define highp vec4 stroke_color\n#pragma mapbox: define mediump float stroke_width\n#pragma mapbox: define lowp float stroke_opacity\n\nvarying vec3 v_data;\n\nvoid main() {\n    #pragma mapbox: initialize highp vec4 color\n    #pragma mapbox: initialize mediump float radius\n    #pragma mapbox: initialize lowp float blur\n    #pragma mapbox: initialize lowp float opacity\n    #pragma mapbox: initialize highp vec4 stroke_color\n    #pragma mapbox: initialize mediump float stroke_width\n    #pragma mapbox: initialize lowp float stroke_opacity\n\n    vec2 extrude = v_data.xy;\n    float extrude_length = length(extrude);\n\n    lowp float antialiasblur = v_data.z;\n    float antialiased_blur = -max(blur, antialiasblur);\n\n    float opacity_t = smoothstep(0.0, antialiased_blur, extrude_length - 1.0);\n\n    float color_t = stroke_width < 0.01 ? 0.0 : smoothstep(\n        antialiased_blur,\n        0.0,\n        extrude_length - radius / (radius + stroke_width)\n    );\n\n    gl_FragColor = opacity_t * mix(color * opacity, stroke_color * stroke_opacity, color_t);\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"uniform mat4 u_matrix;\nuniform bool u_scale_with_map;\nuniform bool u_pitch_with_map;\nuniform vec2 u_extrude_scale;\nuniform highp float u_camera_to_center_distance;\n\nattribute vec2 a_pos;\n\n#pragma mapbox: define highp vec4 color\n#pragma mapbox: define mediump float radius\n#pragma mapbox: define lowp float blur\n#pragma mapbox: define lowp float opacity\n#pragma mapbox: define highp vec4 stroke_color\n#pragma mapbox: define mediump float stroke_width\n#pragma mapbox: define lowp float stroke_opacity\n\nvarying vec3 v_data;\n\nvoid main(void) {\n    #pragma mapbox: initialize highp vec4 color\n    #pragma mapbox: initialize mediump float radius\n    #pragma mapbox: initialize lowp float blur\n    #pragma mapbox: initialize lowp float opacity\n    #pragma mapbox: initialize highp vec4 stroke_color\n    #pragma mapbox: initialize mediump float stroke_width\n    #pragma mapbox: initialize lowp float stroke_opacity\n\n    // unencode the extrusion vector that we snuck into the a_pos vector\n    vec2 extrude = vec2(mod(a_pos, 2.0) * 2.0 - 1.0);\n\n    // multiply a_pos by 0.5, since we had it * 2 in order to sneak\n    // in extrusion data\n    vec2 circle_center = floor(a_pos * 0.5);\n    if (u_pitch_with_map) {\n        vec2 corner_position = circle_center;\n        if (u_scale_with_map) {\n            corner_position += extrude * (radius + stroke_width) * u_extrude_scale;\n        } else {\n            // Pitching the circle with the map effectively scales it with the map\n            // To counteract the effect for pitch-scale: viewport, we rescale the\n            // whole circle based on the pitch scaling effect at its central point\n            vec4 projected_center = u_matrix * vec4(circle_center, 0, 1);\n            corner_position += extrude * (radius + stroke_width) * u_extrude_scale * (projected_center.w / u_camera_to_center_distance);\n        }\n\n        gl_Position = u_matrix * vec4(corner_position, 0, 1);\n    } else {\n        gl_Position = u_matrix * vec4(circle_center, 0, 1);\n\n        if (u_scale_with_map) {\n            gl_Position.xy += extrude * (radius + stroke_width) * u_extrude_scale * u_camera_to_center_distance;\n        } else {\n            gl_Position.xy += extrude * (radius + stroke_width) * u_extrude_scale * gl_Position.w;\n        }\n    }\n\n    // This is a minimum blur distance that serves as a faux-antialiasing for\n    // the circle. since blur is a ratio of the circle's size and the intent is\n    // to keep the blur at roughly 1px, the two are inversely related.\n    lowp float antialiasblur = 1.0 / DEVICE_PIXEL_RATIO / (radius + stroke_width);\n\n    v_data = vec3(extrude.x, extrude.y, antialiasblur);\n}\n"},clippingMask:{fragmentSource:"void main() {\n    gl_FragColor = vec4(1.0);\n}\n",vertexSource:"attribute vec2 a_pos;\n\nuniform mat4 u_matrix;\n\nvoid main() {\n    gl_Position = u_matrix * vec4(a_pos, 0, 1);\n}\n"},heatmap:{fragmentSource:"#pragma mapbox: define highp float weight\n\nuniform highp float u_intensity;\nvarying vec2 v_extrude;\n\n// Gaussian kernel coefficient: 1 / sqrt(2 * PI)\n#define GAUSS_COEF 0.3989422804014327\n\nvoid main() {\n    #pragma mapbox: initialize highp float weight\n\n    // Kernel density estimation with a Gaussian kernel of size 5x5\n    float d = -0.5 * 3.0 * 3.0 * dot(v_extrude, v_extrude);\n    float val = weight * u_intensity * GAUSS_COEF * exp(d);\n\n    gl_FragColor = vec4(val, 1.0, 1.0, 1.0);\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"#pragma mapbox: define highp float weight\n#pragma mapbox: define mediump float radius\n\nuniform mat4 u_matrix;\nuniform float u_extrude_scale;\nuniform float u_opacity;\nuniform float u_intensity;\n\nattribute vec2 a_pos;\n\nvarying vec2 v_extrude;\n\n// Effective \"0\" in the kernel density texture to adjust the kernel size to;\n// this empirically chosen number minimizes artifacts on overlapping kernels\n// for typical heatmap cases (assuming clustered source)\nconst highp float ZERO = 1.0 / 255.0 / 16.0;\n\n// Gaussian kernel coefficient: 1 / sqrt(2 * PI)\n#define GAUSS_COEF 0.3989422804014327\n\nvoid main(void) {\n    #pragma mapbox: initialize highp float weight\n    #pragma mapbox: initialize mediump float radius\n\n    // unencode the extrusion vector that we snuck into the a_pos vector\n    vec2 unscaled_extrude = vec2(mod(a_pos, 2.0) * 2.0 - 1.0);\n\n    // This 'extrude' comes in ranging from [-1, -1], to [1, 1].  We'll use\n    // it to produce the vertices of a square mesh framing the point feature\n    // we're adding to the kernel density texture.  We'll also pass it as\n    // a varying, so that the fragment shader can determine the distance of\n    // each fragment from the point feature.\n    // Before we do so, we need to scale it up sufficiently so that the\n    // kernel falls effectively to zero at the edge of the mesh.\n    // That is, we want to know S such that\n    // weight * u_intensity * GAUSS_COEF * exp(-0.5 * 3.0^2 * S^2) == ZERO\n    // Which solves to:\n    // S = sqrt(-2.0 * log(ZERO / (weight * u_intensity * GAUSS_COEF))) / 3.0\n    float S = sqrt(-2.0 * log(ZERO / weight / u_intensity / GAUSS_COEF)) / 3.0;\n\n    // Pass the varying in units of radius\n    v_extrude = S * unscaled_extrude;\n\n    // Scale by radius and the zoom-based scale factor to produce actual\n    // mesh position\n    vec2 extrude = v_extrude * radius * u_extrude_scale;\n\n    // multiply a_pos by 0.5, since we had it * 2 in order to sneak\n    // in extrusion data\n    vec4 pos = vec4(floor(a_pos * 0.5) + extrude, 0, 1);\n\n    gl_Position = u_matrix * pos;\n}\n"},heatmapTexture:{fragmentSource:"uniform sampler2D u_image;\nuniform sampler2D u_color_ramp;\nuniform float u_opacity;\nvarying vec2 v_pos;\n\nvoid main() {\n    float t = texture2D(u_image, v_pos).r;\n    vec4 color = texture2D(u_color_ramp, vec2(t, 0.5));\n    gl_FragColor = color * u_opacity;\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(0.0);\n#endif\n}\n",vertexSource:"uniform mat4 u_matrix;\nuniform vec2 u_world;\nattribute vec2 a_pos;\nvarying vec2 v_pos;\n\nvoid main() {\n    gl_Position = u_matrix * vec4(a_pos * u_world, 0, 1);\n\n    v_pos.x = a_pos.x;\n    v_pos.y = 1.0 - a_pos.y;\n}\n"},collisionBox:{fragmentSource:"\nvarying float v_placed;\nvarying float v_notUsed;\n\nvoid main() {\n\n    float alpha = 0.5;\n\n    // Red = collision, hide label\n    gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0) * alpha;\n\n    // Blue = no collision, label is showing\n    if (v_placed > 0.5) {\n        gl_FragColor = vec4(0.0, 0.0, 1.0, 0.5) * alpha;\n    }\n\n    if (v_notUsed > 0.5) {\n        // This box not used, fade it out\n        gl_FragColor *= .1;\n    }\n}",vertexSource:"attribute vec2 a_pos;\nattribute vec2 a_anchor_pos;\nattribute vec2 a_extrude;\nattribute vec2 a_placed;\n\nuniform mat4 u_matrix;\nuniform vec2 u_extrude_scale;\nuniform float u_camera_to_center_distance;\n\nvarying float v_placed;\nvarying float v_notUsed;\n\nvoid main() {\n    vec4 projectedPoint = u_matrix * vec4(a_anchor_pos, 0, 1);\n    highp float camera_to_anchor_distance = projectedPoint.w;\n    highp float collision_perspective_ratio = clamp(\n        0.5 + 0.5 * (u_camera_to_center_distance / camera_to_anchor_distance),\n        0.0, // Prevents oversized near-field boxes in pitched/overzoomed tiles\n        4.0);\n\n    gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);\n    gl_Position.xy += a_extrude * u_extrude_scale * gl_Position.w * collision_perspective_ratio;\n\n    v_placed = a_placed.x;\n    v_notUsed = a_placed.y;\n}\n"},collisionCircle:{fragmentSource:"uniform float u_overscale_factor;\n\nvarying float v_placed;\nvarying float v_notUsed;\nvarying float v_radius;\nvarying vec2 v_extrude;\nvarying vec2 v_extrude_scale;\n\nvoid main() {\n    float alpha = 0.5;\n\n    // Red = collision, hide label\n    vec4 color = vec4(1.0, 0.0, 0.0, 1.0) * alpha;\n\n    // Blue = no collision, label is showing\n    if (v_placed > 0.5) {\n        color = vec4(0.0, 0.0, 1.0, 0.5) * alpha;\n    }\n\n    if (v_notUsed > 0.5) {\n        // This box not used, fade it out\n        color *= .2;\n    }\n\n    float extrude_scale_length = length(v_extrude_scale);\n    float extrude_length = length(v_extrude) * extrude_scale_length;\n    float stroke_width = 15.0 * extrude_scale_length / u_overscale_factor;\n    float radius = v_radius * extrude_scale_length;\n\n    float distance_to_edge = abs(extrude_length - radius);\n    float opacity_t = smoothstep(-stroke_width, 0.0, -distance_to_edge);\n\n    gl_FragColor = opacity_t * color;\n}\n",vertexSource:"attribute vec2 a_pos;\nattribute vec2 a_anchor_pos;\nattribute vec2 a_extrude;\nattribute vec2 a_placed;\n\nuniform mat4 u_matrix;\nuniform vec2 u_extrude_scale;\nuniform float u_camera_to_center_distance;\n\nvarying float v_placed;\nvarying float v_notUsed;\nvarying float v_radius;\n\nvarying vec2 v_extrude;\nvarying vec2 v_extrude_scale;\n\nvoid main() {\n    vec4 projectedPoint = u_matrix * vec4(a_anchor_pos, 0, 1);\n    highp float camera_to_anchor_distance = projectedPoint.w;\n    highp float collision_perspective_ratio = clamp(\n        0.5 + 0.5 * (u_camera_to_center_distance / camera_to_anchor_distance),\n        0.0, // Prevents oversized near-field circles in pitched/overzoomed tiles\n        4.0);\n\n    gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);\n\n    highp float padding_factor = 1.2; // Pad the vertices slightly to make room for anti-alias blur\n    gl_Position.xy += a_extrude * u_extrude_scale * padding_factor * gl_Position.w * collision_perspective_ratio;\n\n    v_placed = a_placed.x;\n    v_notUsed = a_placed.y;\n    v_radius = abs(a_extrude.y); // We don't pitch the circles, so both units of the extrusion vector are equal in magnitude to the radius\n\n    v_extrude = a_extrude * padding_factor;\n    v_extrude_scale = u_extrude_scale * u_camera_to_center_distance * collision_perspective_ratio;\n}\n"},debug:{fragmentSource:"uniform highp vec4 u_color;\n\nvoid main() {\n    gl_FragColor = u_color;\n}\n",vertexSource:"attribute vec2 a_pos;\n\nuniform mat4 u_matrix;\n\nvoid main() {\n    gl_Position = u_matrix * vec4(a_pos, 0, 1);\n}\n"},fill:{fragmentSource:"#pragma mapbox: define highp vec4 color\n#pragma mapbox: define lowp float opacity\n\nvoid main() {\n    #pragma mapbox: initialize highp vec4 color\n    #pragma mapbox: initialize lowp float opacity\n\n    gl_FragColor = color * opacity;\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"attribute vec2 a_pos;\n\nuniform mat4 u_matrix;\n\n#pragma mapbox: define highp vec4 color\n#pragma mapbox: define lowp float opacity\n\nvoid main() {\n    #pragma mapbox: initialize highp vec4 color\n    #pragma mapbox: initialize lowp float opacity\n\n    gl_Position = u_matrix * vec4(a_pos, 0, 1);\n}\n"},fillOutline:{fragmentSource:"#pragma mapbox: define highp vec4 outline_color\n#pragma mapbox: define lowp float opacity\n\nvarying vec2 v_pos;\n\nvoid main() {\n    #pragma mapbox: initialize highp vec4 outline_color\n    #pragma mapbox: initialize lowp float opacity\n\n    float dist = length(v_pos - gl_FragCoord.xy);\n    float alpha = 1.0 - smoothstep(0.0, 1.0, dist);\n    gl_FragColor = outline_color * (alpha * opacity);\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"attribute vec2 a_pos;\n\nuniform mat4 u_matrix;\nuniform vec2 u_world;\n\nvarying vec2 v_pos;\n\n#pragma mapbox: define highp vec4 outline_color\n#pragma mapbox: define lowp float opacity\n\nvoid main() {\n    #pragma mapbox: initialize highp vec4 outline_color\n    #pragma mapbox: initialize lowp float opacity\n\n    gl_Position = u_matrix * vec4(a_pos, 0, 1);\n    v_pos = (gl_Position.xy / gl_Position.w + 1.0) / 2.0 * u_world;\n}\n"},fillOutlinePattern:{fragmentSource:"\nuniform vec2 u_texsize;\nuniform sampler2D u_image;\nuniform float u_fade;\n\nvarying vec2 v_pos_a;\nvarying vec2 v_pos_b;\nvarying vec2 v_pos;\n\n#pragma mapbox: define lowp float opacity\n#pragma mapbox: define lowp vec4 pattern_from\n#pragma mapbox: define lowp vec4 pattern_to\n\nvoid main() {\n    #pragma mapbox: initialize lowp float opacity\n    #pragma mapbox: initialize mediump vec4 pattern_from\n    #pragma mapbox: initialize mediump vec4 pattern_to\n\n    vec2 pattern_tl_a = pattern_from.xy;\n    vec2 pattern_br_a = pattern_from.zw;\n    vec2 pattern_tl_b = pattern_to.xy;\n    vec2 pattern_br_b = pattern_to.zw;\n\n    vec2 imagecoord = mod(v_pos_a, 1.0);\n    vec2 pos = mix(pattern_tl_a / u_texsize, pattern_br_a / u_texsize, imagecoord);\n    vec4 color1 = texture2D(u_image, pos);\n\n    vec2 imagecoord_b = mod(v_pos_b, 1.0);\n    vec2 pos2 = mix(pattern_tl_b / u_texsize, pattern_br_b / u_texsize, imagecoord_b);\n    vec4 color2 = texture2D(u_image, pos2);\n\n    // find distance to outline for alpha interpolation\n\n    float dist = length(v_pos - gl_FragCoord.xy);\n    float alpha = 1.0 - smoothstep(0.0, 1.0, dist);\n\n\n    gl_FragColor = mix(color1, color2, u_fade) * alpha * opacity;\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"uniform mat4 u_matrix;\nuniform vec2 u_world;\nuniform vec2 u_pixel_coord_upper;\nuniform vec2 u_pixel_coord_lower;\nuniform vec4 u_scale;\n\nattribute vec2 a_pos;\n\nvarying vec2 v_pos_a;\nvarying vec2 v_pos_b;\nvarying vec2 v_pos;\n\n#pragma mapbox: define lowp float opacity\n#pragma mapbox: define lowp vec4 pattern_from\n#pragma mapbox: define lowp vec4 pattern_to\n\nvoid main() {\n    #pragma mapbox: initialize lowp float opacity\n    #pragma mapbox: initialize mediump vec4 pattern_from\n    #pragma mapbox: initialize mediump vec4 pattern_to\n\n    vec2 pattern_tl_a = pattern_from.xy;\n    vec2 pattern_br_a = pattern_from.zw;\n    vec2 pattern_tl_b = pattern_to.xy;\n    vec2 pattern_br_b = pattern_to.zw;\n\n    float pixelRatio = u_scale.x;\n    float tileRatio = u_scale.y;\n    float fromScale = u_scale.z;\n    float toScale = u_scale.w;\n\n    gl_Position = u_matrix * vec4(a_pos, 0, 1);\n\n    vec2 display_size_a = vec2((pattern_br_a.x - pattern_tl_a.x) / pixelRatio, (pattern_br_a.y - pattern_tl_a.y) / pixelRatio);\n    vec2 display_size_b = vec2((pattern_br_b.x - pattern_tl_b.x) / pixelRatio, (pattern_br_b.y - pattern_tl_b.y) / pixelRatio);\n\n    v_pos_a = get_pattern_pos(u_pixel_coord_upper, u_pixel_coord_lower, fromScale * display_size_a, tileRatio, a_pos);\n    v_pos_b = get_pattern_pos(u_pixel_coord_upper, u_pixel_coord_lower, toScale * display_size_b, tileRatio, a_pos);\n\n    v_pos = (gl_Position.xy / gl_Position.w + 1.0) / 2.0 * u_world;\n}\n"},fillPattern:{fragmentSource:"uniform vec2 u_texsize;\nuniform float u_fade;\n\nuniform sampler2D u_image;\n\nvarying vec2 v_pos_a;\nvarying vec2 v_pos_b;\n\n#pragma mapbox: define lowp float opacity\n#pragma mapbox: define lowp vec4 pattern_from\n#pragma mapbox: define lowp vec4 pattern_to\n\nvoid main() {\n    #pragma mapbox: initialize lowp float opacity\n    #pragma mapbox: initialize mediump vec4 pattern_from\n    #pragma mapbox: initialize mediump vec4 pattern_to\n\n    vec2 pattern_tl_a = pattern_from.xy;\n    vec2 pattern_br_a = pattern_from.zw;\n    vec2 pattern_tl_b = pattern_to.xy;\n    vec2 pattern_br_b = pattern_to.zw;\n\n    vec2 imagecoord = mod(v_pos_a, 1.0);\n    vec2 pos = mix(pattern_tl_a / u_texsize, pattern_br_a / u_texsize, imagecoord);\n    vec4 color1 = texture2D(u_image, pos);\n\n    vec2 imagecoord_b = mod(v_pos_b, 1.0);\n    vec2 pos2 = mix(pattern_tl_b / u_texsize, pattern_br_b / u_texsize, imagecoord_b);\n    vec4 color2 = texture2D(u_image, pos2);\n\n    gl_FragColor = mix(color1, color2, u_fade) * opacity;\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"uniform mat4 u_matrix;\nuniform vec2 u_pixel_coord_upper;\nuniform vec2 u_pixel_coord_lower;\nuniform vec4 u_scale;\n\nattribute vec2 a_pos;\n\nvarying vec2 v_pos_a;\nvarying vec2 v_pos_b;\n\n#pragma mapbox: define lowp float opacity\n#pragma mapbox: define lowp vec4 pattern_from\n#pragma mapbox: define lowp vec4 pattern_to\n\nvoid main() {\n    #pragma mapbox: initialize lowp float opacity\n    #pragma mapbox: initialize mediump vec4 pattern_from\n    #pragma mapbox: initialize mediump vec4 pattern_to\n\n    vec2 pattern_tl_a = pattern_from.xy;\n    vec2 pattern_br_a = pattern_from.zw;\n    vec2 pattern_tl_b = pattern_to.xy;\n    vec2 pattern_br_b = pattern_to.zw;\n\n    float pixelRatio = u_scale.x;\n    float tileZoomRatio = u_scale.y;\n    float fromScale = u_scale.z;\n    float toScale = u_scale.w;\n\n    vec2 display_size_a = vec2((pattern_br_a.x - pattern_tl_a.x) / pixelRatio, (pattern_br_a.y - pattern_tl_a.y) / pixelRatio);\n    vec2 display_size_b = vec2((pattern_br_b.x - pattern_tl_b.x) / pixelRatio, (pattern_br_b.y - pattern_tl_b.y) / pixelRatio);\n    gl_Position = u_matrix * vec4(a_pos, 0, 1);\n\n    v_pos_a = get_pattern_pos(u_pixel_coord_upper, u_pixel_coord_lower, fromScale * display_size_a, tileZoomRatio, a_pos);\n    v_pos_b = get_pattern_pos(u_pixel_coord_upper, u_pixel_coord_lower, toScale * display_size_b, tileZoomRatio, a_pos);\n}\n"},fillExtrusion:{fragmentSource:"varying vec4 v_color;\n#pragma mapbox: define lowp float base\n#pragma mapbox: define lowp float height\n#pragma mapbox: define highp vec4 color\n\nvoid main() {\n    #pragma mapbox: initialize lowp float base\n    #pragma mapbox: initialize lowp float height\n    #pragma mapbox: initialize highp vec4 color\n\n    gl_FragColor = v_color;\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"uniform mat4 u_matrix;\nuniform vec3 u_lightcolor;\nuniform lowp vec3 u_lightpos;\nuniform lowp float u_lightintensity;\n\nattribute vec2 a_pos;\nattribute vec4 a_normal_ed;\n\nvarying vec4 v_color;\n\n#pragma mapbox: define lowp float base\n#pragma mapbox: define lowp float height\n\n#pragma mapbox: define highp vec4 color\n\nvoid main() {\n    #pragma mapbox: initialize lowp float base\n    #pragma mapbox: initialize lowp float height\n    #pragma mapbox: initialize highp vec4 color\n\n    vec3 normal = a_normal_ed.xyz;\n\n    base = max(0.0, base);\n    height = max(0.0, height);\n\n    float t = mod(normal.x, 2.0);\n\n    gl_Position = u_matrix * vec4(a_pos, t > 0.0 ? height : base, 1);\n\n    // Relative luminance (how dark/bright is the surface color?)\n    float colorvalue = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;\n\n    v_color = vec4(0.0, 0.0, 0.0, 1.0);\n\n    // Add slight ambient lighting so no extrusions are totally black\n    vec4 ambientlight = vec4(0.03, 0.03, 0.03, 1.0);\n    color += ambientlight;\n\n    // Calculate cos(theta), where theta is the angle between surface normal and diffuse light ray\n    float directional = clamp(dot(normal / 16384.0, u_lightpos), 0.0, 1.0);\n\n    // Adjust directional so that\n    // the range of values for highlight/shading is narrower\n    // with lower light intensity\n    // and with lighter/brighter surface colors\n    directional = mix((1.0 - u_lightintensity), max((1.0 - colorvalue + u_lightintensity), 1.0), directional);\n\n    // Add gradient along z axis of side surfaces\n    if (normal.y != 0.0) {\n        directional *= clamp((t + base) * pow(height / 150.0, 0.5), mix(0.7, 0.98, 1.0 - u_lightintensity), 1.0);\n    }\n\n    // Assign final color based on surface + ambient light color, diffuse light directional, and light color\n    // with lower bounds adjusted to hue of light\n    // so that shading is tinted with the complementary (opposite) color to the light color\n    v_color.r += clamp(color.r * directional * u_lightcolor.r, mix(0.0, 0.3, 1.0 - u_lightcolor.r), 1.0);\n    v_color.g += clamp(color.g * directional * u_lightcolor.g, mix(0.0, 0.3, 1.0 - u_lightcolor.g), 1.0);\n    v_color.b += clamp(color.b * directional * u_lightcolor.b, mix(0.0, 0.3, 1.0 - u_lightcolor.b), 1.0);\n}\n"},fillExtrusionPattern:{fragmentSource:"uniform vec2 u_texsize;\nuniform float u_fade;\n\nuniform sampler2D u_image;\n\nvarying vec2 v_pos_a;\nvarying vec2 v_pos_b;\nvarying vec4 v_lighting;\n\n#pragma mapbox: define lowp float base\n#pragma mapbox: define lowp float height\n#pragma mapbox: define lowp vec4 pattern_from\n#pragma mapbox: define lowp vec4 pattern_to\n\nvoid main() {\n    #pragma mapbox: initialize lowp float base\n    #pragma mapbox: initialize lowp float height\n    #pragma mapbox: initialize mediump vec4 pattern_from\n    #pragma mapbox: initialize mediump vec4 pattern_to\n\n    vec2 pattern_tl_a = pattern_from.xy;\n    vec2 pattern_br_a = pattern_from.zw;\n    vec2 pattern_tl_b = pattern_to.xy;\n    vec2 pattern_br_b = pattern_to.zw;\n\n    vec2 imagecoord = mod(v_pos_a, 1.0);\n    vec2 pos = mix(pattern_tl_a / u_texsize, pattern_br_a / u_texsize, imagecoord);\n    vec4 color1 = texture2D(u_image, pos);\n\n    vec2 imagecoord_b = mod(v_pos_b, 1.0);\n    vec2 pos2 = mix(pattern_tl_b / u_texsize, pattern_br_b / u_texsize, imagecoord_b);\n    vec4 color2 = texture2D(u_image, pos2);\n\n    vec4 mixedColor = mix(color1, color2, u_fade);\n\n    gl_FragColor = mixedColor * v_lighting;\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"uniform mat4 u_matrix;\nuniform vec2 u_pixel_coord_upper;\nuniform vec2 u_pixel_coord_lower;\nuniform float u_height_factor;\nuniform vec4 u_scale;\n\nuniform vec3 u_lightcolor;\nuniform lowp vec3 u_lightpos;\nuniform lowp float u_lightintensity;\n\nattribute vec2 a_pos;\nattribute vec4 a_normal_ed;\n\nvarying vec2 v_pos_a;\nvarying vec2 v_pos_b;\nvarying vec4 v_lighting;\n\n#pragma mapbox: define lowp float base\n#pragma mapbox: define lowp float height\n#pragma mapbox: define lowp vec4 pattern_from\n#pragma mapbox: define lowp vec4 pattern_to\n\nvoid main() {\n    #pragma mapbox: initialize lowp float base\n    #pragma mapbox: initialize lowp float height\n    #pragma mapbox: initialize mediump vec4 pattern_from\n    #pragma mapbox: initialize mediump vec4 pattern_to\n\n    vec2 pattern_tl_a = pattern_from.xy;\n    vec2 pattern_br_a = pattern_from.zw;\n    vec2 pattern_tl_b = pattern_to.xy;\n    vec2 pattern_br_b = pattern_to.zw;\n\n    float pixelRatio = u_scale.x;\n    float tileRatio = u_scale.y;\n    float fromScale = u_scale.z;\n    float toScale = u_scale.w;\n\n    vec3 normal = a_normal_ed.xyz;\n    float edgedistance = a_normal_ed.w;\n\n    vec2 display_size_a = vec2((pattern_br_a.x - pattern_tl_a.x) / pixelRatio, (pattern_br_a.y - pattern_tl_a.y) / pixelRatio);\n    vec2 display_size_b = vec2((pattern_br_b.x - pattern_tl_b.x) / pixelRatio, (pattern_br_b.y - pattern_tl_b.y) / pixelRatio);\n\n    base = max(0.0, base);\n    height = max(0.0, height);\n\n    float t = mod(normal.x, 2.0);\n    float z = t > 0.0 ? height : base;\n\n    gl_Position = u_matrix * vec4(a_pos, z, 1);\n\n    vec2 pos = normal.x == 1.0 && normal.y == 0.0 && normal.z == 16384.0\n        ? a_pos // extrusion top\n        : vec2(edgedistance, z * u_height_factor); // extrusion side\n\n    v_pos_a = get_pattern_pos(u_pixel_coord_upper, u_pixel_coord_lower, fromScale * display_size_a, tileRatio, pos);\n    v_pos_b = get_pattern_pos(u_pixel_coord_upper, u_pixel_coord_lower, toScale * display_size_b, tileRatio, pos);\n\n    v_lighting = vec4(0.0, 0.0, 0.0, 1.0);\n    float directional = clamp(dot(normal / 16383.0, u_lightpos), 0.0, 1.0);\n    directional = mix((1.0 - u_lightintensity), max((0.5 + u_lightintensity), 1.0), directional);\n\n    if (normal.y != 0.0) {\n        directional *= clamp((t + base) * pow(height / 150.0, 0.5), mix(0.7, 0.98, 1.0 - u_lightintensity), 1.0);\n    }\n\n    v_lighting.rgb += clamp(directional * u_lightcolor, mix(vec3(0.0), vec3(0.3), 1.0 - u_lightcolor), vec3(1.0));\n}\n"},extrusionTexture:{fragmentSource:"uniform sampler2D u_image;\nuniform float u_opacity;\nvarying vec2 v_pos;\n\nvoid main() {\n    gl_FragColor = texture2D(u_image, v_pos) * u_opacity;\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(0.0);\n#endif\n}\n",vertexSource:"uniform mat4 u_matrix;\nuniform vec2 u_world;\nattribute vec2 a_pos;\nvarying vec2 v_pos;\n\nvoid main() {\n    gl_Position = u_matrix * vec4(a_pos * u_world, 0, 1);\n\n    v_pos.x = a_pos.x;\n    v_pos.y = 1.0 - a_pos.y;\n}\n"},hillshadePrepare:{fragmentSource:"#ifdef GL_ES\nprecision highp float;\n#endif\n\nuniform sampler2D u_image;\nvarying vec2 v_pos;\nuniform vec2 u_dimension;\nuniform float u_zoom;\nuniform float u_maxzoom;\n\nfloat getElevation(vec2 coord, float bias) {\n    // Convert encoded elevation value to meters\n    vec4 data = texture2D(u_image, coord) * 255.0;\n    return (data.r + data.g * 256.0 + data.b * 256.0 * 256.0) / 4.0;\n}\n\nvoid main() {\n    vec2 epsilon = 1.0 / u_dimension;\n\n    // queried pixels:\n    // +-----------+\n    // |   |   |   |\n    // | a | b | c |\n    // |   |   |   |\n    // +-----------+\n    // |   |   |   |\n    // | d | e | f |\n    // |   |   |   |\n    // +-----------+\n    // |   |   |   |\n    // | g | h | i |\n    // |   |   |   |\n    // +-----------+\n\n    float a = getElevation(v_pos + vec2(-epsilon.x, -epsilon.y), 0.0);\n    float b = getElevation(v_pos + vec2(0, -epsilon.y), 0.0);\n    float c = getElevation(v_pos + vec2(epsilon.x, -epsilon.y), 0.0);\n    float d = getElevation(v_pos + vec2(-epsilon.x, 0), 0.0);\n    float e = getElevation(v_pos, 0.0);\n    float f = getElevation(v_pos + vec2(epsilon.x, 0), 0.0);\n    float g = getElevation(v_pos + vec2(-epsilon.x, epsilon.y), 0.0);\n    float h = getElevation(v_pos + vec2(0, epsilon.y), 0.0);\n    float i = getElevation(v_pos + vec2(epsilon.x, epsilon.y), 0.0);\n\n    // here we divide the x and y slopes by 8 * pixel size\n    // where pixel size (aka meters/pixel) is:\n    // circumference of the world / (pixels per tile * number of tiles)\n    // which is equivalent to: 8 * 40075016.6855785 / (512 * pow(2, u_zoom))\n    // which can be reduced to: pow(2, 19.25619978527 - u_zoom)\n    // we want to vertically exaggerate the hillshading though, because otherwise\n    // it is barely noticeable at low zooms. to do this, we multiply this by some\n    // scale factor pow(2, (u_zoom - u_maxzoom) * a) where a is an arbitrary value\n    // Here we use a=0.3 which works out to the expression below. see \n    // nickidlugash's awesome breakdown for more info\n    // https://github.com/mapbox/mapbox-gl-js/pull/5286#discussion_r148419556\n    float exaggeration = u_zoom < 2.0 ? 0.4 : u_zoom < 4.5 ? 0.35 : 0.3;\n\n    vec2 deriv = vec2(\n        (c + f + f + i) - (a + d + d + g),\n        (g + h + h + i) - (a + b + b + c)\n    ) /  pow(2.0, (u_zoom - u_maxzoom) * exaggeration + 19.2562 - u_zoom);\n\n    gl_FragColor = clamp(vec4(\n        deriv.x / 2.0 + 0.5,\n        deriv.y / 2.0 + 0.5,\n        1.0,\n        1.0), 0.0, 1.0);\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"uniform mat4 u_matrix;\n\nattribute vec2 a_pos;\nattribute vec2 a_texture_pos;\n\nvarying vec2 v_pos;\n\nvoid main() {\n    gl_Position = u_matrix * vec4(a_pos, 0, 1);\n    v_pos = (a_texture_pos / 8192.0) / 2.0 + 0.25;\n}\n"},hillshade:{fragmentSource:"uniform sampler2D u_image;\nvarying vec2 v_pos;\n\nuniform vec2 u_latrange;\nuniform vec2 u_light;\nuniform vec4 u_shadow;\nuniform vec4 u_highlight;\nuniform vec4 u_accent;\n\n#define PI 3.141592653589793\n\nvoid main() {\n    vec4 pixel = texture2D(u_image, v_pos);\n\n    vec2 deriv = ((pixel.rg * 2.0) - 1.0);\n\n    // We divide the slope by a scale factor based on the cosin of the pixel's approximate latitude\n    // to account for mercator projection distortion. see #4807 for details\n    float scaleFactor = cos(radians((u_latrange[0] - u_latrange[1]) * (1.0 - v_pos.y) + u_latrange[1]));\n    // We also multiply the slope by an arbitrary z-factor of 1.25\n    float slope = atan(1.25 * length(deriv) / scaleFactor);\n    float aspect = deriv.x != 0.0 ? atan(deriv.y, -deriv.x) : PI / 2.0 * (deriv.y > 0.0 ? 1.0 : -1.0);\n\n    float intensity = u_light.x;\n    // We add PI to make this property match the global light object, which adds PI/2 to the light's azimuthal\n    // position property to account for 0deg corresponding to north/the top of the viewport in the style spec\n    // and the original shader was written to accept (-illuminationDirection - 90) as the azimuthal.\n    float azimuth = u_light.y + PI;\n\n    // We scale the slope exponentially based on intensity, using a calculation similar to\n    // the exponential interpolation function in the style spec:\n    // https://github.com/mapbox/mapbox-gl-js/blob/master/src/style-spec/expression/definitions/interpolate.js#L217-L228\n    // so that higher intensity values create more opaque hillshading.\n    float base = 1.875 - intensity * 1.75;\n    float maxValue = 0.5 * PI;\n    float scaledSlope = intensity != 0.5 ? ((pow(base, slope) - 1.0) / (pow(base, maxValue) - 1.0)) * maxValue : slope;\n\n    // The accent color is calculated with the cosine of the slope while the shade color is calculated with the sine\n    // so that the accent color's rate of change eases in while the shade color's eases out.\n    float accent = cos(scaledSlope);\n    // We multiply both the accent and shade color by a clamped intensity value\n    // so that intensities >= 0.5 do not additionally affect the color values\n    // while intensity values < 0.5 make the overall color more transparent.\n    vec4 accent_color = (1.0 - accent) * u_accent * clamp(intensity * 2.0, 0.0, 1.0);\n    float shade = abs(mod((aspect + azimuth) / PI + 0.5, 2.0) - 1.0);\n    vec4 shade_color = mix(u_shadow, u_highlight, shade) * sin(scaledSlope) * clamp(intensity * 2.0, 0.0, 1.0);\n    gl_FragColor = accent_color * (1.0 - shade_color.a) + shade_color;\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"uniform mat4 u_matrix;\n\nattribute vec2 a_pos;\nattribute vec2 a_texture_pos;\n\nvarying vec2 v_pos;\n\nvoid main() {\n    gl_Position = u_matrix * vec4(a_pos, 0, 1);\n    v_pos = a_texture_pos / 8192.0;\n}\n"},line:{fragmentSource:"#pragma mapbox: define highp vec4 color\n#pragma mapbox: define lowp float blur\n#pragma mapbox: define lowp float opacity\n\nvarying vec2 v_width2;\nvarying vec2 v_normal;\nvarying float v_gamma_scale;\n\nvoid main() {\n    #pragma mapbox: initialize highp vec4 color\n    #pragma mapbox: initialize lowp float blur\n    #pragma mapbox: initialize lowp float opacity\n\n    // Calculate the distance of the pixel from the line in pixels.\n    float dist = length(v_normal) * v_width2.s;\n\n    // Calculate the antialiasing fade factor. This is either when fading in\n    // the line in case of an offset line (v_width2.t) or when fading out\n    // (v_width2.s)\n    float blur2 = (blur + 1.0 / DEVICE_PIXEL_RATIO) * v_gamma_scale;\n    float alpha = clamp(min(dist - (v_width2.t - blur2), v_width2.s - dist) / blur2, 0.0, 1.0);\n\n    gl_FragColor = color * (alpha * opacity);\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"\n\n// the distance over which the line edge fades out.\n// Retina devices need a smaller distance to avoid aliasing.\n#define ANTIALIASING 1.0 / DEVICE_PIXEL_RATIO / 2.0\n\n// floor(127 / 2) == 63.0\n// the maximum allowed miter limit is 2.0 at the moment. the extrude normal is\n// stored in a byte (-128..127). we scale regular normals up to length 63, but\n// there are also \"special\" normals that have a bigger length (of up to 126 in\n// this case).\n// #define scale 63.0\n#define scale 0.015873016\n\nattribute vec4 a_pos_normal;\nattribute vec4 a_data;\n\nuniform mat4 u_matrix;\nuniform mediump float u_ratio;\nuniform vec2 u_gl_units_to_pixels;\n\nvarying vec2 v_normal;\nvarying vec2 v_width2;\nvarying float v_gamma_scale;\nvarying highp float v_linesofar;\n\n#pragma mapbox: define highp vec4 color\n#pragma mapbox: define lowp float blur\n#pragma mapbox: define lowp float opacity\n#pragma mapbox: define mediump float gapwidth\n#pragma mapbox: define lowp float offset\n#pragma mapbox: define mediump float width\n\nvoid main() {\n    #pragma mapbox: initialize highp vec4 color\n    #pragma mapbox: initialize lowp float blur\n    #pragma mapbox: initialize lowp float opacity\n    #pragma mapbox: initialize mediump float gapwidth\n    #pragma mapbox: initialize lowp float offset\n    #pragma mapbox: initialize mediump float width\n\n    vec2 a_extrude = a_data.xy - 128.0;\n    float a_direction = mod(a_data.z, 4.0) - 1.0;\n\n    v_linesofar = (floor(a_data.z / 4.0) + a_data.w * 64.0) * 2.0;\n\n    vec2 pos = a_pos_normal.xy;\n\n    // x is 1 if it's a round cap, 0 otherwise\n    // y is 1 if the normal points up, and -1 if it points down\n    mediump vec2 normal = a_pos_normal.zw;\n    v_normal = normal;\n\n    // these transformations used to be applied in the JS and native code bases.\n    // moved them into the shader for clarity and simplicity.\n    gapwidth = gapwidth / 2.0;\n    float halfwidth = width / 2.0;\n    offset = -1.0 * offset;\n\n    float inset = gapwidth + (gapwidth > 0.0 ? ANTIALIASING : 0.0);\n    float outset = gapwidth + halfwidth * (gapwidth > 0.0 ? 2.0 : 1.0) + (halfwidth == 0.0 ? 0.0 : ANTIALIASING);\n\n    // Scale the extrusion vector down to a normal and then up by the line width\n    // of this vertex.\n    mediump vec2 dist = outset * a_extrude * scale;\n\n    // Calculate the offset when drawing a line that is to the side of the actual line.\n    // We do this by creating a vector that points towards the extrude, but rotate\n    // it when we're drawing round end points (a_direction = -1 or 1) since their\n    // extrude vector points in another direction.\n    mediump float u = 0.5 * a_direction;\n    mediump float t = 1.0 - abs(u);\n    mediump vec2 offset2 = offset * a_extrude * scale * normal.y * mat2(t, -u, u, t);\n\n    vec4 projected_extrude = u_matrix * vec4(dist / u_ratio, 0.0, 0.0);\n    gl_Position = u_matrix * vec4(pos + offset2 / u_ratio, 0.0, 1.0) + projected_extrude;\n\n    // calculate how much the perspective view squishes or stretches the extrude\n    float extrude_length_without_perspective = length(dist);\n    float extrude_length_with_perspective = length(projected_extrude.xy / gl_Position.w * u_gl_units_to_pixels);\n    v_gamma_scale = extrude_length_without_perspective / extrude_length_with_perspective;\n\n    v_width2 = vec2(outset, inset);\n}\n"},lineGradient:{fragmentSource:"\n#pragma mapbox: define lowp float blur\n#pragma mapbox: define lowp float opacity\n\nuniform sampler2D u_image;\n\nvarying vec2 v_width2;\nvarying vec2 v_normal;\nvarying float v_gamma_scale;\nvarying highp float v_lineprogress;\n\nvoid main() {\n    #pragma mapbox: initialize lowp float blur\n    #pragma mapbox: initialize lowp float opacity\n\n    // Calculate the distance of the pixel from the line in pixels.\n    float dist = length(v_normal) * v_width2.s;\n\n    // Calculate the antialiasing fade factor. This is either when fading in\n    // the line in case of an offset line (v_width2.t) or when fading out\n    // (v_width2.s)\n    float blur2 = (blur + 1.0 / DEVICE_PIXEL_RATIO) * v_gamma_scale;\n    float alpha = clamp(min(dist - (v_width2.t - blur2), v_width2.s - dist) / blur2, 0.0, 1.0);\n\n    // For gradient lines, v_lineprogress is the ratio along the entire line,\n    // scaled to [0, 2^15), and the gradient ramp is stored in a texture.\n    vec4 color = texture2D(u_image, vec2(v_lineprogress, 0.5));\n\n    gl_FragColor = color * (alpha * opacity);\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"\n// the attribute conveying progress along a line is scaled to [0, 2^15)\n#define MAX_LINE_DISTANCE 32767.0\n\n// the distance over which the line edge fades out.\n// Retina devices need a smaller distance to avoid aliasing.\n#define ANTIALIASING 1.0 / DEVICE_PIXEL_RATIO / 2.0\n\n// floor(127 / 2) == 63.0\n// the maximum allowed miter limit is 2.0 at the moment. the extrude normal is\n// stored in a byte (-128..127). we scale regular normals up to length 63, but\n// there are also \"special\" normals that have a bigger length (of up to 126 in\n// this case).\n// #define scale 63.0\n#define scale 0.015873016\n\nattribute vec4 a_pos_normal;\nattribute vec4 a_data;\n\nuniform mat4 u_matrix;\nuniform mediump float u_ratio;\nuniform vec2 u_gl_units_to_pixels;\n\nvarying vec2 v_normal;\nvarying vec2 v_width2;\nvarying float v_gamma_scale;\nvarying highp float v_lineprogress;\n\n#pragma mapbox: define lowp float blur\n#pragma mapbox: define lowp float opacity\n#pragma mapbox: define mediump float gapwidth\n#pragma mapbox: define lowp float offset\n#pragma mapbox: define mediump float width\n\nvoid main() {\n    #pragma mapbox: initialize lowp float blur\n    #pragma mapbox: initialize lowp float opacity\n    #pragma mapbox: initialize mediump float gapwidth\n    #pragma mapbox: initialize lowp float offset\n    #pragma mapbox: initialize mediump float width\n\n    vec2 a_extrude = a_data.xy - 128.0;\n    float a_direction = mod(a_data.z, 4.0) - 1.0;\n\n    v_lineprogress = (floor(a_data.z / 4.0) + a_data.w * 64.0) * 2.0 / MAX_LINE_DISTANCE;\n\n    vec2 pos = a_pos_normal.xy;\n\n    // x is 1 if it's a round cap, 0 otherwise\n    // y is 1 if the normal points up, and -1 if it points down\n    mediump vec2 normal = a_pos_normal.zw;\n    v_normal = normal;\n\n    // these transformations used to be applied in the JS and native code bases.\n    // moved them into the shader for clarity and simplicity.\n    gapwidth = gapwidth / 2.0;\n    float halfwidth = width / 2.0;\n    offset = -1.0 * offset;\n\n    float inset = gapwidth + (gapwidth > 0.0 ? ANTIALIASING : 0.0);\n    float outset = gapwidth + halfwidth * (gapwidth > 0.0 ? 2.0 : 1.0) + (halfwidth == 0.0 ? 0.0 : ANTIALIASING);\n\n    // Scale the extrusion vector down to a normal and then up by the line width\n    // of this vertex.\n    mediump vec2 dist = outset * a_extrude * scale;\n\n    // Calculate the offset when drawing a line that is to the side of the actual line.\n    // We do this by creating a vector that points towards the extrude, but rotate\n    // it when we're drawing round end points (a_direction = -1 or 1) since their\n    // extrude vector points in another direction.\n    mediump float u = 0.5 * a_direction;\n    mediump float t = 1.0 - abs(u);\n    mediump vec2 offset2 = offset * a_extrude * scale * normal.y * mat2(t, -u, u, t);\n\n    vec4 projected_extrude = u_matrix * vec4(dist / u_ratio, 0.0, 0.0);\n    gl_Position = u_matrix * vec4(pos + offset2 / u_ratio, 0.0, 1.0) + projected_extrude;\n\n    // calculate how much the perspective view squishes or stretches the extrude\n    float extrude_length_without_perspective = length(dist);\n    float extrude_length_with_perspective = length(projected_extrude.xy / gl_Position.w * u_gl_units_to_pixels);\n    v_gamma_scale = extrude_length_without_perspective / extrude_length_with_perspective;\n\n    v_width2 = vec2(outset, inset);\n}\n"},linePattern:{fragmentSource:"uniform vec2 u_texsize;\nuniform float u_fade;\nuniform mediump vec4 u_scale;\n\nuniform sampler2D u_image;\n\nvarying vec2 v_normal;\nvarying vec2 v_width2;\nvarying float v_linesofar;\nvarying float v_gamma_scale;\n\n#pragma mapbox: define lowp vec4 pattern_from\n#pragma mapbox: define lowp vec4 pattern_to\n#pragma mapbox: define lowp float blur\n#pragma mapbox: define lowp float opacity\n\nvoid main() {\n    #pragma mapbox: initialize mediump vec4 pattern_from\n    #pragma mapbox: initialize mediump vec4 pattern_to\n\n    #pragma mapbox: initialize lowp float blur\n    #pragma mapbox: initialize lowp float opacity\n\n    vec2 pattern_tl_a = pattern_from.xy;\n    vec2 pattern_br_a = pattern_from.zw;\n    vec2 pattern_tl_b = pattern_to.xy;\n    vec2 pattern_br_b = pattern_to.zw;\n\n    float pixelRatio = u_scale.x;\n    float tileZoomRatio = u_scale.y;\n    float fromScale = u_scale.z;\n    float toScale = u_scale.w;\n\n    vec2 display_size_a = vec2((pattern_br_a.x - pattern_tl_a.x) / pixelRatio, (pattern_br_a.y - pattern_tl_a.y) / pixelRatio);\n    vec2 display_size_b = vec2((pattern_br_b.x - pattern_tl_b.x) / pixelRatio, (pattern_br_b.y - pattern_tl_b.y) / pixelRatio);\n\n    vec2 pattern_size_a = vec2(display_size_a.x * fromScale / tileZoomRatio, display_size_a.y);\n    vec2 pattern_size_b = vec2(display_size_b.x * toScale / tileZoomRatio, display_size_b.y);\n\n    // Calculate the distance of the pixel from the line in pixels.\n    float dist = length(v_normal) * v_width2.s;\n\n    // Calculate the antialiasing fade factor. This is either when fading in\n    // the line in case of an offset line (v_width2.t) or when fading out\n    // (v_width2.s)\n    float blur2 = (blur + 1.0 / DEVICE_PIXEL_RATIO) * v_gamma_scale;\n    float alpha = clamp(min(dist - (v_width2.t - blur2), v_width2.s - dist) / blur2, 0.0, 1.0);\n\n    float x_a = mod(v_linesofar / pattern_size_a.x, 1.0);\n    float x_b = mod(v_linesofar / pattern_size_b.x, 1.0);\n\n    // v_normal.y is 0 at the midpoint of the line, -1 at the lower edge, 1 at the upper edge\n    // we clamp the line width outset to be between 0 and half the pattern height plus padding (2.0)\n    // to ensure we don't sample outside the designated symbol on the sprite sheet.\n    // 0.5 is added to shift the component to be bounded between 0 and 1 for interpolation of\n    // the texture coordinate\n    float y_a = 0.5 + (v_normal.y * clamp(v_width2.s, 0.0, (pattern_size_a.y + 2.0) / 2.0) / pattern_size_a.y);\n    float y_b = 0.5 + (v_normal.y * clamp(v_width2.s, 0.0, (pattern_size_b.y + 2.0) / 2.0) / pattern_size_b.y);\n    vec2 pos_a = mix(pattern_tl_a / u_texsize, pattern_br_a / u_texsize, vec2(x_a, y_a));\n    vec2 pos_b = mix(pattern_tl_b / u_texsize, pattern_br_b / u_texsize, vec2(x_b, y_b));\n\n    vec4 color = mix(texture2D(u_image, pos_a), texture2D(u_image, pos_b), u_fade);\n\n    gl_FragColor = color * alpha * opacity;\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"// floor(127 / 2) == 63.0\n// the maximum allowed miter limit is 2.0 at the moment. the extrude normal is\n// stored in a byte (-128..127). we scale regular normals up to length 63, but\n// there are also \"special\" normals that have a bigger length (of up to 126 in\n// this case).\n// #define scale 63.0\n#define scale 0.015873016\n\n// We scale the distance before adding it to the buffers so that we can store\n// long distances for long segments. Use this value to unscale the distance.\n#define LINE_DISTANCE_SCALE 2.0\n\n// the distance over which the line edge fades out.\n// Retina devices need a smaller distance to avoid aliasing.\n#define ANTIALIASING 1.0 / DEVICE_PIXEL_RATIO / 2.0\n\nattribute vec4 a_pos_normal;\nattribute vec4 a_data;\n\nuniform mat4 u_matrix;\nuniform vec2 u_gl_units_to_pixels;\nuniform mediump float u_ratio;\n\nvarying vec2 v_normal;\nvarying vec2 v_width2;\nvarying float v_linesofar;\nvarying float v_gamma_scale;\n\n#pragma mapbox: define lowp float blur\n#pragma mapbox: define lowp float opacity\n#pragma mapbox: define lowp float offset\n#pragma mapbox: define mediump float gapwidth\n#pragma mapbox: define mediump float width\n#pragma mapbox: define lowp vec4 pattern_from\n#pragma mapbox: define lowp vec4 pattern_to\n\nvoid main() {\n    #pragma mapbox: initialize lowp float blur\n    #pragma mapbox: initialize lowp float opacity\n    #pragma mapbox: initialize lowp float offset\n    #pragma mapbox: initialize mediump float gapwidth\n    #pragma mapbox: initialize mediump float width\n    #pragma mapbox: initialize mediump vec4 pattern_from\n    #pragma mapbox: initialize mediump vec4 pattern_to\n\n    vec2 a_extrude = a_data.xy - 128.0;\n    float a_direction = mod(a_data.z, 4.0) - 1.0;\n    float a_linesofar = (floor(a_data.z / 4.0) + a_data.w * 64.0) * LINE_DISTANCE_SCALE;\n    // float tileRatio = u_scale.y;\n    vec2 pos = a_pos_normal.xy;\n\n    // x is 1 if it's a round cap, 0 otherwise\n    // y is 1 if the normal points up, and -1 if it points down\n    mediump vec2 normal = a_pos_normal.zw;\n    v_normal = normal;\n\n    // these transformations used to be applied in the JS and native code bases.\n    // moved them into the shader for clarity and simplicity.\n    gapwidth = gapwidth / 2.0;\n    float halfwidth = width / 2.0;\n    offset = -1.0 * offset;\n\n    float inset = gapwidth + (gapwidth > 0.0 ? ANTIALIASING : 0.0);\n    float outset = gapwidth + halfwidth * (gapwidth > 0.0 ? 2.0 : 1.0) + (halfwidth == 0.0 ? 0.0 : ANTIALIASING);\n\n    // Scale the extrusion vector down to a normal and then up by the line width\n    // of this vertex.\n    mediump vec2 dist = outset * a_extrude * scale;\n\n    // Calculate the offset when drawing a line that is to the side of the actual line.\n    // We do this by creating a vector that points towards the extrude, but rotate\n    // it when we're drawing round end points (a_direction = -1 or 1) since their\n    // extrude vector points in another direction.\n    mediump float u = 0.5 * a_direction;\n    mediump float t = 1.0 - abs(u);\n    mediump vec2 offset2 = offset * a_extrude * scale * normal.y * mat2(t, -u, u, t);\n\n    vec4 projected_extrude = u_matrix * vec4(dist / u_ratio, 0.0, 0.0);\n    gl_Position = u_matrix * vec4(pos + offset2 / u_ratio, 0.0, 1.0) + projected_extrude;\n\n    // calculate how much the perspective view squishes or stretches the extrude\n    float extrude_length_without_perspective = length(dist);\n    float extrude_length_with_perspective = length(projected_extrude.xy / gl_Position.w * u_gl_units_to_pixels);\n    v_gamma_scale = extrude_length_without_perspective / extrude_length_with_perspective;\n\n    v_linesofar = a_linesofar;\n    v_width2 = vec2(outset, inset);\n}\n"},lineSDF:{fragmentSource:"\nuniform sampler2D u_image;\nuniform float u_sdfgamma;\nuniform float u_mix;\n\nvarying vec2 v_normal;\nvarying vec2 v_width2;\nvarying vec2 v_tex_a;\nvarying vec2 v_tex_b;\nvarying float v_gamma_scale;\n\n#pragma mapbox: define highp vec4 color\n#pragma mapbox: define lowp float blur\n#pragma mapbox: define lowp float opacity\n#pragma mapbox: define mediump float width\n#pragma mapbox: define lowp float floorwidth\n\nvoid main() {\n    #pragma mapbox: initialize highp vec4 color\n    #pragma mapbox: initialize lowp float blur\n    #pragma mapbox: initialize lowp float opacity\n    #pragma mapbox: initialize mediump float width\n    #pragma mapbox: initialize lowp float floorwidth\n\n    // Calculate the distance of the pixel from the line in pixels.\n    float dist = length(v_normal) * v_width2.s;\n\n    // Calculate the antialiasing fade factor. This is either when fading in\n    // the line in case of an offset line (v_width2.t) or when fading out\n    // (v_width2.s)\n    float blur2 = (blur + 1.0 / DEVICE_PIXEL_RATIO) * v_gamma_scale;\n    float alpha = clamp(min(dist - (v_width2.t - blur2), v_width2.s - dist) / blur2, 0.0, 1.0);\n\n    float sdfdist_a = texture2D(u_image, v_tex_a).a;\n    float sdfdist_b = texture2D(u_image, v_tex_b).a;\n    float sdfdist = mix(sdfdist_a, sdfdist_b, u_mix);\n    alpha *= smoothstep(0.5 - u_sdfgamma / floorwidth, 0.5 + u_sdfgamma / floorwidth, sdfdist);\n\n    gl_FragColor = color * (alpha * opacity);\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"// floor(127 / 2) == 63.0\n// the maximum allowed miter limit is 2.0 at the moment. the extrude normal is\n// stored in a byte (-128..127). we scale regular normals up to length 63, but\n// there are also \"special\" normals that have a bigger length (of up to 126 in\n// this case).\n// #define scale 63.0\n#define scale 0.015873016\n\n// We scale the distance before adding it to the buffers so that we can store\n// long distances for long segments. Use this value to unscale the distance.\n#define LINE_DISTANCE_SCALE 2.0\n\n// the distance over which the line edge fades out.\n// Retina devices need a smaller distance to avoid aliasing.\n#define ANTIALIASING 1.0 / DEVICE_PIXEL_RATIO / 2.0\n\nattribute vec4 a_pos_normal;\nattribute vec4 a_data;\n\nuniform mat4 u_matrix;\nuniform mediump float u_ratio;\nuniform vec2 u_patternscale_a;\nuniform float u_tex_y_a;\nuniform vec2 u_patternscale_b;\nuniform float u_tex_y_b;\nuniform vec2 u_gl_units_to_pixels;\n\nvarying vec2 v_normal;\nvarying vec2 v_width2;\nvarying vec2 v_tex_a;\nvarying vec2 v_tex_b;\nvarying float v_gamma_scale;\n\n#pragma mapbox: define highp vec4 color\n#pragma mapbox: define lowp float blur\n#pragma mapbox: define lowp float opacity\n#pragma mapbox: define mediump float gapwidth\n#pragma mapbox: define lowp float offset\n#pragma mapbox: define mediump float width\n#pragma mapbox: define lowp float floorwidth\n\nvoid main() {\n    #pragma mapbox: initialize highp vec4 color\n    #pragma mapbox: initialize lowp float blur\n    #pragma mapbox: initialize lowp float opacity\n    #pragma mapbox: initialize mediump float gapwidth\n    #pragma mapbox: initialize lowp float offset\n    #pragma mapbox: initialize mediump float width\n    #pragma mapbox: initialize lowp float floorwidth\n\n    vec2 a_extrude = a_data.xy - 128.0;\n    float a_direction = mod(a_data.z, 4.0) - 1.0;\n    float a_linesofar = (floor(a_data.z / 4.0) + a_data.w * 64.0) * LINE_DISTANCE_SCALE;\n\n    vec2 pos = a_pos_normal.xy;\n\n    // x is 1 if it's a round cap, 0 otherwise\n    // y is 1 if the normal points up, and -1 if it points down\n    mediump vec2 normal = a_pos_normal.zw;\n    v_normal = normal;\n\n    // these transformations used to be applied in the JS and native code bases.\n    // moved them into the shader for clarity and simplicity.\n    gapwidth = gapwidth / 2.0;\n    float halfwidth = width / 2.0;\n    offset = -1.0 * offset;\n\n    float inset = gapwidth + (gapwidth > 0.0 ? ANTIALIASING : 0.0);\n    float outset = gapwidth + halfwidth * (gapwidth > 0.0 ? 2.0 : 1.0) + (halfwidth == 0.0 ? 0.0 : ANTIALIASING);\n\n    // Scale the extrusion vector down to a normal and then up by the line width\n    // of this vertex.\n    mediump vec2 dist =outset * a_extrude * scale;\n\n    // Calculate the offset when drawing a line that is to the side of the actual line.\n    // We do this by creating a vector that points towards the extrude, but rotate\n    // it when we're drawing round end points (a_direction = -1 or 1) since their\n    // extrude vector points in another direction.\n    mediump float u = 0.5 * a_direction;\n    mediump float t = 1.0 - abs(u);\n    mediump vec2 offset2 = offset * a_extrude * scale * normal.y * mat2(t, -u, u, t);\n\n    vec4 projected_extrude = u_matrix * vec4(dist / u_ratio, 0.0, 0.0);\n    gl_Position = u_matrix * vec4(pos + offset2 / u_ratio, 0.0, 1.0) + projected_extrude;\n\n    // calculate how much the perspective view squishes or stretches the extrude\n    float extrude_length_without_perspective = length(dist);\n    float extrude_length_with_perspective = length(projected_extrude.xy / gl_Position.w * u_gl_units_to_pixels);\n    v_gamma_scale = extrude_length_without_perspective / extrude_length_with_perspective;\n\n    v_tex_a = vec2(a_linesofar * u_patternscale_a.x / floorwidth, normal.y * u_patternscale_a.y + u_tex_y_a);\n    v_tex_b = vec2(a_linesofar * u_patternscale_b.x / floorwidth, normal.y * u_patternscale_b.y + u_tex_y_b);\n\n    v_width2 = vec2(outset, inset);\n}\n"},raster:{fragmentSource:"uniform float u_fade_t;\nuniform float u_opacity;\nuniform sampler2D u_image0;\nuniform sampler2D u_image1;\nvarying vec2 v_pos0;\nvarying vec2 v_pos1;\n\nuniform float u_brightness_low;\nuniform float u_brightness_high;\n\nuniform float u_saturation_factor;\nuniform float u_contrast_factor;\nuniform vec3 u_spin_weights;\n\nvoid main() {\n\n    // read and cross-fade colors from the main and parent tiles\n    vec4 color0 = texture2D(u_image0, v_pos0);\n    vec4 color1 = texture2D(u_image1, v_pos1);\n    if (color0.a > 0.0) {\n        color0.rgb = color0.rgb / color0.a;\n    }\n    if (color1.a > 0.0) {\n        color1.rgb = color1.rgb / color1.a;\n    }\n    vec4 color = mix(color0, color1, u_fade_t);\n    color.a *= u_opacity;\n    vec3 rgb = color.rgb;\n\n    // spin\n    rgb = vec3(\n        dot(rgb, u_spin_weights.xyz),\n        dot(rgb, u_spin_weights.zxy),\n        dot(rgb, u_spin_weights.yzx));\n\n    // saturation\n    float average = (color.r + color.g + color.b) / 3.0;\n    rgb += (average - rgb) * u_saturation_factor;\n\n    // contrast\n    rgb = (rgb - 0.5) * u_contrast_factor + 0.5;\n\n    // brightness\n    vec3 u_high_vec = vec3(u_brightness_low, u_brightness_low, u_brightness_low);\n    vec3 u_low_vec = vec3(u_brightness_high, u_brightness_high, u_brightness_high);\n\n    gl_FragColor = vec4(mix(u_high_vec, u_low_vec, rgb) * color.a, color.a);\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"uniform mat4 u_matrix;\nuniform vec2 u_tl_parent;\nuniform float u_scale_parent;\nuniform float u_buffer_scale;\n\nattribute vec2 a_pos;\nattribute vec2 a_texture_pos;\n\nvarying vec2 v_pos0;\nvarying vec2 v_pos1;\n\nvoid main() {\n    gl_Position = u_matrix * vec4(a_pos, 0, 1);\n    // We are using Int16 for texture position coordinates to give us enough precision for\n    // fractional coordinates. We use 8192 to scale the texture coordinates in the buffer\n    // as an arbitrarily high number to preserve adequate precision when rendering.\n    // This is also the same value as the EXTENT we are using for our tile buffer pos coordinates,\n    // so math for modifying either is consistent.\n    v_pos0 = (((a_texture_pos / 8192.0) - 0.5) / u_buffer_scale ) + 0.5;\n    v_pos1 = (v_pos0 * u_scale_parent) + u_tl_parent;\n}\n"},symbolIcon:{fragmentSource:"uniform sampler2D u_texture;\n\n#pragma mapbox: define lowp float opacity\n\nvarying vec2 v_tex;\nvarying float v_fade_opacity;\n\nvoid main() {\n    #pragma mapbox: initialize lowp float opacity\n\n    lowp float alpha = opacity * v_fade_opacity;\n    gl_FragColor = texture2D(u_texture, v_tex) * alpha;\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"const float PI = 3.141592653589793;\n\nattribute vec4 a_pos_offset;\nattribute vec4 a_data;\nattribute vec3 a_projected_pos;\nattribute float a_fade_opacity;\n\nuniform bool u_is_size_zoom_constant;\nuniform bool u_is_size_feature_constant;\nuniform highp float u_size_t; // used to interpolate between zoom stops when size is a composite function\nuniform highp float u_size; // used when size is both zoom and feature constant\nuniform highp float u_camera_to_center_distance;\nuniform highp float u_pitch;\nuniform bool u_rotate_symbol;\nuniform highp float u_aspect_ratio;\nuniform float u_fade_change;\n\n#pragma mapbox: define lowp float opacity\n\nuniform mat4 u_matrix;\nuniform mat4 u_label_plane_matrix;\nuniform mat4 u_gl_coord_matrix;\n\nuniform bool u_is_text;\nuniform bool u_pitch_with_map;\n\nuniform vec2 u_texsize;\n\nvarying vec2 v_tex;\nvarying float v_fade_opacity;\n\nvoid main() {\n    #pragma mapbox: initialize lowp float opacity\n\n    vec2 a_pos = a_pos_offset.xy;\n    vec2 a_offset = a_pos_offset.zw;\n\n    vec2 a_tex = a_data.xy;\n    vec2 a_size = a_data.zw;\n\n    highp float segment_angle = -a_projected_pos[2];\n\n    float size;\n    if (!u_is_size_zoom_constant && !u_is_size_feature_constant) {\n        size = mix(a_size[0], a_size[1], u_size_t) / 256.0;\n    } else if (u_is_size_zoom_constant && !u_is_size_feature_constant) {\n        size = a_size[0] / 256.0;\n    } else if (!u_is_size_zoom_constant && u_is_size_feature_constant) {\n        size = u_size;\n    } else {\n        size = u_size;\n    }\n\n    vec4 projectedPoint = u_matrix * vec4(a_pos, 0, 1);\n    highp float camera_to_anchor_distance = projectedPoint.w;\n    // See comments in symbol_sdf.vertex\n    highp float distance_ratio = u_pitch_with_map ?\n        camera_to_anchor_distance / u_camera_to_center_distance :\n        u_camera_to_center_distance / camera_to_anchor_distance;\n    highp float perspective_ratio = clamp(\n            0.5 + 0.5 * distance_ratio,\n            0.0, // Prevents oversized near-field symbols in pitched/overzoomed tiles\n            4.0);\n\n    size *= perspective_ratio;\n\n    float fontScale = u_is_text ? size / 24.0 : size;\n\n    highp float symbol_rotation = 0.0;\n    if (u_rotate_symbol) {\n        // See comments in symbol_sdf.vertex\n        vec4 offsetProjectedPoint = u_matrix * vec4(a_pos + vec2(1, 0), 0, 1);\n\n        vec2 a = projectedPoint.xy / projectedPoint.w;\n        vec2 b = offsetProjectedPoint.xy / offsetProjectedPoint.w;\n\n        symbol_rotation = atan((b.y - a.y) / u_aspect_ratio, b.x - a.x);\n    }\n\n    highp float angle_sin = sin(segment_angle + symbol_rotation);\n    highp float angle_cos = cos(segment_angle + symbol_rotation);\n    mat2 rotation_matrix = mat2(angle_cos, -1.0 * angle_sin, angle_sin, angle_cos);\n\n    vec4 projected_pos = u_label_plane_matrix * vec4(a_projected_pos.xy, 0.0, 1.0);\n    gl_Position = u_gl_coord_matrix * vec4(projected_pos.xy / projected_pos.w + rotation_matrix * (a_offset / 32.0 * fontScale), 0.0, 1.0);\n\n    v_tex = a_tex / u_texsize;\n    vec2 fade_opacity = unpack_opacity(a_fade_opacity);\n    float fade_change = fade_opacity[1] > 0.5 ? u_fade_change : -u_fade_change;\n    v_fade_opacity = max(0.0, min(1.0, fade_opacity[0] + fade_change));\n}\n"},symbolSDF:{fragmentSource:"#define SDF_PX 8.0\n#define EDGE_GAMMA 0.105/DEVICE_PIXEL_RATIO\n\nuniform bool u_is_halo;\n#pragma mapbox: define highp vec4 fill_color\n#pragma mapbox: define highp vec4 halo_color\n#pragma mapbox: define lowp float opacity\n#pragma mapbox: define lowp float halo_width\n#pragma mapbox: define lowp float halo_blur\n\nuniform sampler2D u_texture;\nuniform highp float u_gamma_scale;\nuniform bool u_is_text;\n\nvarying vec2 v_data0;\nvarying vec3 v_data1;\n\nvoid main() {\n    #pragma mapbox: initialize highp vec4 fill_color\n    #pragma mapbox: initialize highp vec4 halo_color\n    #pragma mapbox: initialize lowp float opacity\n    #pragma mapbox: initialize lowp float halo_width\n    #pragma mapbox: initialize lowp float halo_blur\n\n    vec2 tex = v_data0.xy;\n    float gamma_scale = v_data1.x;\n    float size = v_data1.y;\n    float fade_opacity = v_data1[2];\n\n    float fontScale = u_is_text ? size / 24.0 : size;\n\n    lowp vec4 color = fill_color;\n    highp float gamma = EDGE_GAMMA / (fontScale * u_gamma_scale);\n    lowp float buff = (256.0 - 64.0) / 256.0;\n    if (u_is_halo) {\n        color = halo_color;\n        gamma = (halo_blur * 1.19 / SDF_PX + EDGE_GAMMA) / (fontScale * u_gamma_scale);\n        buff = (6.0 - halo_width / fontScale) / SDF_PX;\n    }\n\n    lowp float dist = texture2D(u_texture, tex).a;\n    highp float gamma_scaled = gamma * gamma_scale;\n    highp float alpha = smoothstep(buff - gamma_scaled, buff + gamma_scaled, dist);\n\n    gl_FragColor = color * (alpha * opacity * fade_opacity);\n\n#ifdef OVERDRAW_INSPECTOR\n    gl_FragColor = vec4(1.0);\n#endif\n}\n",vertexSource:"const float PI = 3.141592653589793;\n\nattribute vec4 a_pos_offset;\nattribute vec4 a_data;\nattribute vec3 a_projected_pos;\nattribute float a_fade_opacity;\n\n// contents of a_size vary based on the type of property value\n// used for {text,icon}-size.\n// For constants, a_size is disabled.\n// For source functions, we bind only one value per vertex: the value of {text,icon}-size evaluated for the current feature.\n// For composite functions:\n// [ text-size(lowerZoomStop, feature),\n//   text-size(upperZoomStop, feature) ]\nuniform bool u_is_size_zoom_constant;\nuniform bool u_is_size_feature_constant;\nuniform highp float u_size_t; // used to interpolate between zoom stops when size is a composite function\nuniform highp float u_size; // used when size is both zoom and feature constant\n\n#pragma mapbox: define highp vec4 fill_color\n#pragma mapbox: define highp vec4 halo_color\n#pragma mapbox: define lowp float opacity\n#pragma mapbox: define lowp float halo_width\n#pragma mapbox: define lowp float halo_blur\n\nuniform mat4 u_matrix;\nuniform mat4 u_label_plane_matrix;\nuniform mat4 u_gl_coord_matrix;\n\nuniform bool u_is_text;\nuniform bool u_pitch_with_map;\nuniform highp float u_pitch;\nuniform bool u_rotate_symbol;\nuniform highp float u_aspect_ratio;\nuniform highp float u_camera_to_center_distance;\nuniform float u_fade_change;\n\nuniform vec2 u_texsize;\n\nvarying vec2 v_data0;\nvarying vec3 v_data1;\n\nvoid main() {\n    #pragma mapbox: initialize highp vec4 fill_color\n    #pragma mapbox: initialize highp vec4 halo_color\n    #pragma mapbox: initialize lowp float opacity\n    #pragma mapbox: initialize lowp float halo_width\n    #pragma mapbox: initialize lowp float halo_blur\n\n    vec2 a_pos = a_pos_offset.xy;\n    vec2 a_offset = a_pos_offset.zw;\n\n    vec2 a_tex = a_data.xy;\n    vec2 a_size = a_data.zw;\n\n    highp float segment_angle = -a_projected_pos[2];\n    float size;\n\n    if (!u_is_size_zoom_constant && !u_is_size_feature_constant) {\n        size = mix(a_size[0], a_size[1], u_size_t) / 256.0;\n    } else if (u_is_size_zoom_constant && !u_is_size_feature_constant) {\n        size = a_size[0] / 256.0;\n    } else if (!u_is_size_zoom_constant && u_is_size_feature_constant) {\n        size = u_size;\n    } else {\n        size = u_size;\n    }\n\n    vec4 projectedPoint = u_matrix * vec4(a_pos, 0, 1);\n    highp float camera_to_anchor_distance = projectedPoint.w;\n    // If the label is pitched with the map, layout is done in pitched space,\n    // which makes labels in the distance smaller relative to viewport space.\n    // We counteract part of that effect by multiplying by the perspective ratio.\n    // If the label isn't pitched with the map, we do layout in viewport space,\n    // which makes labels in the distance larger relative to the features around\n    // them. We counteract part of that effect by dividing by the perspective ratio.\n    highp float distance_ratio = u_pitch_with_map ?\n        camera_to_anchor_distance / u_camera_to_center_distance :\n        u_camera_to_center_distance / camera_to_anchor_distance;\n    highp float perspective_ratio = clamp(\n        0.5 + 0.5 * distance_ratio,\n        0.0, // Prevents oversized near-field symbols in pitched/overzoomed tiles\n        4.0);\n\n    size *= perspective_ratio;\n\n    float fontScale = u_is_text ? size / 24.0 : size;\n\n    highp float symbol_rotation = 0.0;\n    if (u_rotate_symbol) {\n        // Point labels with 'rotation-alignment: map' are horizontal with respect to tile units\n        // To figure out that angle in projected space, we draw a short horizontal line in tile\n        // space, project it, and measure its angle in projected space.\n        vec4 offsetProjectedPoint = u_matrix * vec4(a_pos + vec2(1, 0), 0, 1);\n\n        vec2 a = projectedPoint.xy / projectedPoint.w;\n        vec2 b = offsetProjectedPoint.xy / offsetProjectedPoint.w;\n\n        symbol_rotation = atan((b.y - a.y) / u_aspect_ratio, b.x - a.x);\n    }\n\n    highp float angle_sin = sin(segment_angle + symbol_rotation);\n    highp float angle_cos = cos(segment_angle + symbol_rotation);\n    mat2 rotation_matrix = mat2(angle_cos, -1.0 * angle_sin, angle_sin, angle_cos);\n\n    vec4 projected_pos = u_label_plane_matrix * vec4(a_projected_pos.xy, 0.0, 1.0);\n    gl_Position = u_gl_coord_matrix * vec4(projected_pos.xy / projected_pos.w + rotation_matrix * (a_offset / 32.0 * fontScale), 0.0, 1.0);\n    float gamma_scale = gl_Position.w;\n\n    vec2 tex = a_tex / u_texsize;\n    vec2 fade_opacity = unpack_opacity(a_fade_opacity);\n    float fade_change = fade_opacity[1] > 0.5 ? u_fade_change : -u_fade_change;\n    float interpolated_fade_opacity = max(0.0, min(1.0, fade_opacity[0] + fade_change));\n\n    v_data0 = vec2(tex.x, tex.y);\n    v_data1 = vec3(gamma_scale, size, interpolated_fade_opacity);\n}\n"}},We=/#pragma mapbox: ([\w]+) ([\w]+) ([\w]+) ([\w]+)/g,Xe=function(t){var e=Ge[t],i={};e.fragmentSource=e.fragmentSource.replace(We,function(t,e,n,o,r){return i[r]=!0,"define"===e?"\n#ifndef HAS_UNIFORM_u_"+r+"\nvarying "+n+" "+o+" "+r+";\n#else\nuniform "+n+" "+o+" u_"+r+";\n#endif\n":"\n#ifdef HAS_UNIFORM_u_"+r+"\n    "+n+" "+o+" "+r+" = u_"+r+";\n#endif\n"}),e.vertexSource=e.vertexSource.replace(We,function(t,e,n,o,r){var a="float"===o?"vec2":"vec4",s=r.match(/color/)?"color":a;return i[r]?"define"===e?"\n#ifndef HAS_UNIFORM_u_"+r+"\nuniform lowp float a_"+r+"_t;\nattribute "+n+" "+a+" a_"+r+";\nvarying "+n+" "+o+" "+r+";\n#else\nuniform "+n+" "+o+" u_"+r+";\n#endif\n":"vec4"===s?"\n#ifndef HAS_UNIFORM_u_"+r+"\n    "+r+" = a_"+r+";\n#else\n    "+n+" "+o+" "+r+" = u_"+r+";\n#endif\n":"\n#ifndef HAS_UNIFORM_u_"+r+"\n    "+r+" = unpack_mix_"+s+"(a_"+r+", a_"+r+"_t);\n#else\n    "+n+" "+o+" "+r+" = u_"+r+";\n#endif\n":"define"===e?"\n#ifndef HAS_UNIFORM_u_"+r+"\nuniform lowp float a_"+r+"_t;\nattribute "+n+" "+a+" a_"+r+";\n#else\nuniform "+n+" "+o+" u_"+r+";\n#endif\n":"vec4"===s?"\n#ifndef HAS_UNIFORM_u_"+r+"\n    "+n+" "+o+" "+r+" = a_"+r+";\n#else\n    "+n+" "+o+" "+r+" = u_"+r+";\n#endif\n":"\n#ifndef HAS_UNIFORM_u_"+r+"\n    "+n+" "+o+" "+r+" = unpack_mix_"+s+"(a_"+r+", a_"+r+"_t);\n#else\n    "+n+" "+o+" "+r+" = u_"+r+";\n#endif\n"});};for(var He in Ge)Xe(He);var Ke=Ge,Ye=function(){this.boundProgram=null,this.boundLayoutVertexBuffer=null,this.boundPaintVertexBuffers=[],this.boundIndexBuffer=null,this.boundVertexOffset=null,this.boundDynamicVertexBuffer=null,this.vao=null;};Ye.prototype.bind=function(t,e,i,n,o,r,a,s){this.context=t;for(var l=this.boundPaintVertexBuffers.length!==n.length,c=0;!l&&c<n.length;c++)this.boundPaintVertexBuffers[c]!==n[c]&&(l=!0);var h=!this.vao||this.boundProgram!==e||this.boundLayoutVertexBuffer!==i||l||this.boundIndexBuffer!==o||this.boundVertexOffset!==r||this.boundDynamicVertexBuffer!==a||this.boundDynamicVertexBuffer2!==s;!t.extVertexArrayObject||h?this.freshBind(e,i,n,o,r,a,s):(t.bindVertexArrayOES.set(this.vao),a&&a.bind(),o&&o.dynamicDraw&&o.bind(),s&&s.bind());},Ye.prototype.freshBind=function(t,e,i,n,o,r,a){var s,l=t.numAttributes,c=this.context,h=c.gl;if(c.extVertexArrayObject)this.vao&&this.destroy(),this.vao=c.extVertexArrayObject.createVertexArrayOES(),c.bindVertexArrayOES.set(this.vao),s=0,this.boundProgram=t,this.boundLayoutVertexBuffer=e,this.boundPaintVertexBuffers=i,this.boundIndexBuffer=n,this.boundVertexOffset=o,this.boundDynamicVertexBuffer=r,this.boundDynamicVertexBuffer2=a;else{s=c.currentNumAttributes||0;for(var u=l;u<s;u++)h.disableVertexAttribArray(u);}e.enableAttributes(h,t);for(var p=0,d=i;p<d.length;p+=1){d[p].enableAttributes(h,t);}r&&r.enableAttributes(h,t),a&&a.enableAttributes(h,t),e.bind(),e.setVertexAttribPointers(h,t,o);for(var _=0,f=i;_<f.length;_+=1){var m=f[_];m.bind(),m.setVertexAttribPointers(h,t,o);}r&&(r.bind(),r.setVertexAttribPointers(h,t,o)),n&&n.bind(),a&&(a.bind(),a.setVertexAttribPointers(h,t,o)),c.currentNumAttributes=l;},Ye.prototype.destroy=function(){this.vao&&(this.context.extVertexArrayObject.deleteVertexArrayOES(this.vao),this.vao=null);};var Je=function(e,i,n,o,r){var a=e.gl;this.program=a.createProgram();var s=n.defines().concat("#define DEVICE_PIXEL_RATIO "+t.browser.devicePixelRatio.toFixed(1));r&&s.push("#define OVERDRAW_INSPECTOR;");var l=s.concat(Ke.prelude.fragmentSource,i.fragmentSource).join("\n"),c=s.concat(Ke.prelude.vertexSource,i.vertexSource).join("\n"),h=a.createShader(a.FRAGMENT_SHADER);a.shaderSource(h,l),a.compileShader(h),a.attachShader(this.program,h);var u=a.createShader(a.VERTEX_SHADER);a.shaderSource(u,c),a.compileShader(u),a.attachShader(this.program,u);for(var p=n.layoutAttributes||[],d=0;d<p.length;d++)a.bindAttribLocation(this.program,d,p[d].name);a.linkProgram(this.program),this.numAttributes=a.getProgramParameter(this.program,a.ACTIVE_ATTRIBUTES),this.attributes={};for(var _={},f=0;f<this.numAttributes;f++){var m=a.getActiveAttrib(this.program,f);m&&(this.attributes[m.name]=a.getAttribLocation(this.program,m.name));}for(var g=a.getProgramParameter(this.program,a.ACTIVE_UNIFORMS),v=0;v<g;v++){var y=a.getActiveUniform(this.program,v);y&&(_[y.name]=a.getUniformLocation(this.program,y.name));}this.fixedUniforms=o(e,_),this.binderUniforms=n.getUniforms(e,_);};function Qe(e,i,n){var o=1/ve(n,1,i.transform.tileZoom),r=Math.pow(2,n.tileID.overscaledZ),a=n.tileSize*Math.pow(2,i.transform.tileZoom)/r,s=a*(n.tileID.canonical.x+n.tileID.wrap*r),l=a*n.tileID.canonical.y;return {u_image:0,u_texsize:n.imageAtlasTexture.size,u_scale:[t.browser.devicePixelRatio,o,e.fromScale,e.toScale],u_fade:e.t,u_pixel_coord_upper:[s>>16,l>>16],u_pixel_coord_lower:[65535&s,65535&l]}}Je.prototype.draw=function(t,e,i,n,o,r,a,s,l,c,h,u,p,d,_){var f,m=t.gl;for(var g in t.program.set(this.program),t.setDepthMode(i),t.setStencilMode(n),t.setColorMode(o),this.fixedUniforms)this.fixedUniforms[g].set(r[g]);p&&p.setUniforms(t,this.binderUniforms,h,{zoom:u});for(var v=(f={},f[m.LINES]=2,f[m.TRIANGLES]=3,f[m.LINE_STRIP]=1,f)[e],y=0,x=c.get();y<x.length;y+=1){var b=x[y],w=b.vaos||(b.vaos={});(w[a]||(w[a]=new Ye)).bind(t,this,s,p?p.getPaintVertexBuffers():[],l,b.vertexOffset,d,_),m.drawElements(e,b.primitiveLength*v,m.UNSIGNED_SHORT,b.primitiveOffset*v*2);}};var $e=function(e,i){var n=i.style.light,o=n.properties.get("position"),r=[o.x,o.y,o.z],a=t.create$2();"viewport"===n.properties.get("anchor")&&t.fromRotation(a,-i.transform.angle),t.transformMat3(r,r,a);var s=n.properties.get("color");return {u_matrix:e,u_lightpos:r,u_lightintensity:n.properties.get("intensity"),u_lightcolor:[s.r,s.g,s.b]}},ti=function(e,i,n,o,r){return t.extend($e(e,i),Qe(o,i,r),{u_height_factor:-Math.pow(2,n.overscaledZ)/r.tileSize/8})},ei=function(e,i,n){var o=t.create();t.ortho(o,0,e.width,e.height,0,0,1);var r=e.context.gl;return {u_matrix:o,u_world:[r.drawingBufferWidth,r.drawingBufferHeight],u_image:n,u_opacity:i.paint.get("fill-extrusion-opacity")}},ii=function(t){return {u_matrix:t}},ni=function(e,i,n,o){return t.extend(ii(e),Qe(n,i,o))},oi=function(t,e){return {u_matrix:t,u_world:e}},ri=function(e,i,n,o,r){return t.extend(ni(e,i,n,o),{u_world:r})},ai=function(t,e,i,n){var o,r,a=t.transform;if("map"===n.paint.get("circle-pitch-alignment")){var s=ve(i,1,a.zoom);o=!0,r=[s,s];}else o=!1,r=a.pixelsToGLUnits;return {u_camera_to_center_distance:a.cameraToCenterDistance,u_scale_with_map:+("map"===n.paint.get("circle-pitch-scale")),u_matrix:t.translatePosMatrix(e.posMatrix,i,n.paint.get("circle-translate"),n.paint.get("circle-translate-anchor")),u_pitch_with_map:+o,u_extrude_scale:r}},si=function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_camera_to_center_distance:new t.Uniform1f(e,i.u_camera_to_center_distance),u_pixels_to_tile_units:new t.Uniform1f(e,i.u_pixels_to_tile_units),u_extrude_scale:new t.Uniform2f(e,i.u_extrude_scale),u_overscale_factor:new t.Uniform1f(e,i.u_overscale_factor)}},li=function(t,e,i){var n=ve(i,1,e.zoom),o=Math.pow(2,e.zoom-i.tileID.overscaledZ),r=i.tileID.overscaleFactor();return {u_matrix:t,u_camera_to_center_distance:e.cameraToCenterDistance,u_pixels_to_tile_units:n,u_extrude_scale:[e.pixelsToGLUnits[0]/(n*o),e.pixelsToGLUnits[1]/(n*o)],u_overscale_factor:r}},ci=function(t,e){return {u_matrix:t,u_color:e}},hi=function(t){return {u_matrix:t}},ui=function(t,e,i,n){return {u_matrix:t,u_extrude_scale:ve(e,1,i),u_intensity:n}},pi=function(e,i,n,o){var r=t.create();t.ortho(r,0,e.width,e.height,0,0,1);var a=e.context.gl;return {u_matrix:r,u_world:[a.drawingBufferWidth,a.drawingBufferHeight],u_image:n,u_color_ramp:o,u_opacity:i.paint.get("heatmap-opacity")}},di=function(e,i,n){var o=n.paint.get("hillshade-shadow-color"),r=n.paint.get("hillshade-highlight-color"),a=n.paint.get("hillshade-accent-color"),s=n.paint.get("hillshade-illumination-direction")*(Math.PI/180);return "viewport"===n.paint.get("hillshade-illumination-anchor")&&(s-=e.transform.angle),{u_matrix:e.transform.calculatePosMatrix(i.tileID.toUnwrapped(),!0),u_image:0,u_latrange:function(e,i){var n=i.toCoordinate(),o=new t.Coordinate(n.column,n.row+1,n.zoom);return [e.transform.coordinateLocation(n).lat,e.transform.coordinateLocation(o).lat]}(e,i.tileID),u_light:[n.paint.get("hillshade-exaggeration"),s],u_shadow:o,u_highlight:r,u_accent:a}},_i=function(e,i){var n=e.dem.dim,o=t.create();return t.ortho(o,0,t.EXTENT,-t.EXTENT,0,0,1),t.translate(o,o,[0,-t.EXTENT,0]),{u_matrix:o,u_image:1,u_dimension:[2*n,2*n],u_zoom:e.tileID.overscaledZ,u_maxzoom:i}};var fi=function(t,e,i){var n=t.transform;return {u_matrix:xi(t,e,i),u_ratio:1/ve(e,1,n.zoom),u_gl_units_to_pixels:[1/n.pixelsToGLUnits[0],1/n.pixelsToGLUnits[1]]}},mi=function(e,i,n){return t.extend(fi(e,i,n),{u_image:0})},gi=function(e,i,n,o){var r=e.transform,a=yi(i,r);return {u_matrix:xi(e,i,n),u_texsize:i.imageAtlasTexture.size,u_ratio:1/ve(i,1,r.zoom),u_image:0,u_scale:[t.browser.devicePixelRatio,a,o.fromScale,o.toScale],u_fade:o.t,u_gl_units_to_pixels:[1/r.pixelsToGLUnits[0],1/r.pixelsToGLUnits[1]]}},vi=function(e,i,n,o,r){var a=e.transform,s=e.lineAtlas,l=yi(i,a),c="round"===n.layout.get("line-cap"),h=s.getDash(o.from,c),u=s.getDash(o.to,c),p=h.width*r.fromScale,d=u.width*r.toScale;return t.extend(fi(e,i,n),{u_patternscale_a:[l/p,-h.height/2],u_patternscale_b:[l/d,-u.height/2],u_sdfgamma:s.width/(256*Math.min(p,d)*t.browser.devicePixelRatio)/2,u_image:0,u_tex_y_a:h.y,u_tex_y_b:u.y,u_mix:r.t})};function yi(t,e){return 1/ve(t,1,e.tileZoom)}function xi(t,e,i){return t.translatePosMatrix(e.tileID.posMatrix,e,i.paint.get("line-translate"),i.paint.get("line-translate-anchor"))}var bi=function(t,e,i,n,o){return {u_matrix:t,u_tl_parent:e,u_scale_parent:i,u_buffer_scale:1,u_fade_t:n.mix,u_opacity:n.opacity*o.paint.get("raster-opacity"),u_image0:0,u_image1:1,u_brightness_low:o.paint.get("raster-brightness-min"),u_brightness_high:o.paint.get("raster-brightness-max"),u_saturation_factor:(a=o.paint.get("raster-saturation"),a>0?1-1/(1.001-a):-a),u_contrast_factor:(r=o.paint.get("raster-contrast"),r>0?1/(1-r):1+r),u_spin_weights:function(t){t*=Math.PI/180;var e=Math.sin(t),i=Math.cos(t);return [(2*i+1)/3,(-Math.sqrt(3)*e-i+1)/3,(Math.sqrt(3)*e-i+1)/3]}(o.paint.get("raster-hue-rotate"))};var r,a;};var wi=function(t,e,i,n,o,r,a,s,l,c){var h=o.transform;return {u_is_size_zoom_constant:+("constant"===t||"source"===t),u_is_size_feature_constant:+("constant"===t||"camera"===t),u_size_t:e?e.uSizeT:0,u_size:e?e.uSize:0,u_camera_to_center_distance:h.cameraToCenterDistance,u_pitch:h.pitch/360*2*Math.PI,u_rotate_symbol:+i,u_aspect_ratio:h.width/h.height,u_fade_change:o.options.fadeDuration?o.symbolFadeChange:1,u_matrix:r,u_label_plane_matrix:a,u_gl_coord_matrix:s,u_is_text:+l,u_pitch_with_map:+n,u_texsize:c,u_texture:0}},Ei=function(e,i,n,o,r,a,s,l,c,h,u){var p=r.transform;return t.extend(wi(e,i,n,o,r,a,s,l,c,h),{u_gamma_scale:o?Math.cos(p._pitch)*p.cameraToCenterDistance:1,u_is_halo:+u})},Ti=function(t,e,i){return {u_matrix:t,u_opacity:e,u_color:i}},Si=function(e,i,n,o,r,a){return t.extend(function(t,e,i,n){var o=i.imageManager.getPattern(t.from),r=i.imageManager.getPattern(t.to),a=i.imageManager.getPixelSize(),s=a.width,l=a.height,c=Math.pow(2,n.tileID.overscaledZ),h=n.tileSize*Math.pow(2,i.transform.tileZoom)/c,u=h*(n.tileID.canonical.x+n.tileID.wrap*c),p=h*n.tileID.canonical.y;return {u_image:0,u_pattern_tl_a:o.tl,u_pattern_br_a:o.br,u_pattern_tl_b:r.tl,u_pattern_br_b:r.br,u_texsize:[s,l],u_mix:e.t,u_pattern_size_a:o.displaySize,u_pattern_size_b:r.displaySize,u_scale_a:e.fromScale,u_scale_b:e.toScale,u_tile_units_to_pixels:1/ve(n,1,i.transform.tileZoom),u_pixel_coord_upper:[u>>16,p>>16],u_pixel_coord_lower:[65535&u,65535&p]}}(o,a,n,r),{u_matrix:e,u_opacity:i})},Ii={fillExtrusion:function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_lightpos:new t.Uniform3f(e,i.u_lightpos),u_lightintensity:new t.Uniform1f(e,i.u_lightintensity),u_lightcolor:new t.Uniform3f(e,i.u_lightcolor)}},fillExtrusionPattern:function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_lightpos:new t.Uniform3f(e,i.u_lightpos),u_lightintensity:new t.Uniform1f(e,i.u_lightintensity),u_lightcolor:new t.Uniform3f(e,i.u_lightcolor),u_height_factor:new t.Uniform1f(e,i.u_height_factor),u_image:new t.Uniform1i(e,i.u_image),u_texsize:new t.Uniform2f(e,i.u_texsize),u_pixel_coord_upper:new t.Uniform2f(e,i.u_pixel_coord_upper),u_pixel_coord_lower:new t.Uniform2f(e,i.u_pixel_coord_lower),u_scale:new t.Uniform4f(e,i.u_scale),u_fade:new t.Uniform1f(e,i.u_fade)}},extrusionTexture:function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_world:new t.Uniform2f(e,i.u_world),u_image:new t.Uniform1i(e,i.u_image),u_opacity:new t.Uniform1f(e,i.u_opacity)}},fill:function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix)}},fillPattern:function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_image:new t.Uniform1i(e,i.u_image),u_texsize:new t.Uniform2f(e,i.u_texsize),u_pixel_coord_upper:new t.Uniform2f(e,i.u_pixel_coord_upper),u_pixel_coord_lower:new t.Uniform2f(e,i.u_pixel_coord_lower),u_scale:new t.Uniform4f(e,i.u_scale),u_fade:new t.Uniform1f(e,i.u_fade)}},fillOutline:function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_world:new t.Uniform2f(e,i.u_world)}},fillOutlinePattern:function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_world:new t.Uniform2f(e,i.u_world),u_image:new t.Uniform1i(e,i.u_image),u_texsize:new t.Uniform2f(e,i.u_texsize),u_pixel_coord_upper:new t.Uniform2f(e,i.u_pixel_coord_upper),u_pixel_coord_lower:new t.Uniform2f(e,i.u_pixel_coord_lower),u_scale:new t.Uniform4f(e,i.u_scale),u_fade:new t.Uniform1f(e,i.u_fade)}},circle:function(e,i){return {u_camera_to_center_distance:new t.Uniform1f(e,i.u_camera_to_center_distance),u_scale_with_map:new t.Uniform1i(e,i.u_scale_with_map),u_pitch_with_map:new t.Uniform1i(e,i.u_pitch_with_map),u_extrude_scale:new t.Uniform2f(e,i.u_extrude_scale),u_matrix:new t.UniformMatrix4f(e,i.u_matrix)}},collisionBox:si,collisionCircle:si,debug:function(e,i){return {u_color:new t.UniformColor(e,i.u_color),u_matrix:new t.UniformMatrix4f(e,i.u_matrix)}},clippingMask:function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix)}},heatmap:function(e,i){return {u_extrude_scale:new t.Uniform1f(e,i.u_extrude_scale),u_intensity:new t.Uniform1f(e,i.u_intensity),u_matrix:new t.UniformMatrix4f(e,i.u_matrix)}},heatmapTexture:function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_world:new t.Uniform2f(e,i.u_world),u_image:new t.Uniform1i(e,i.u_image),u_color_ramp:new t.Uniform1i(e,i.u_color_ramp),u_opacity:new t.Uniform1f(e,i.u_opacity)}},hillshade:function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_image:new t.Uniform1i(e,i.u_image),u_latrange:new t.Uniform2f(e,i.u_latrange),u_light:new t.Uniform2f(e,i.u_light),u_shadow:new t.UniformColor(e,i.u_shadow),u_highlight:new t.UniformColor(e,i.u_highlight),u_accent:new t.UniformColor(e,i.u_accent)}},hillshadePrepare:function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_image:new t.Uniform1i(e,i.u_image),u_dimension:new t.Uniform2f(e,i.u_dimension),u_zoom:new t.Uniform1f(e,i.u_zoom),u_maxzoom:new t.Uniform1f(e,i.u_maxzoom)}},line:function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_ratio:new t.Uniform1f(e,i.u_ratio),u_gl_units_to_pixels:new t.Uniform2f(e,i.u_gl_units_to_pixels)}},lineGradient:function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_ratio:new t.Uniform1f(e,i.u_ratio),u_gl_units_to_pixels:new t.Uniform2f(e,i.u_gl_units_to_pixels),u_image:new t.Uniform1i(e,i.u_image)}},linePattern:function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_texsize:new t.Uniform2f(e,i.u_texsize),u_ratio:new t.Uniform1f(e,i.u_ratio),u_image:new t.Uniform1i(e,i.u_image),u_gl_units_to_pixels:new t.Uniform2f(e,i.u_gl_units_to_pixels),u_scale:new t.Uniform4f(e,i.u_scale),u_fade:new t.Uniform1f(e,i.u_fade)}},lineSDF:function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_ratio:new t.Uniform1f(e,i.u_ratio),u_gl_units_to_pixels:new t.Uniform2f(e,i.u_gl_units_to_pixels),u_patternscale_a:new t.Uniform2f(e,i.u_patternscale_a),u_patternscale_b:new t.Uniform2f(e,i.u_patternscale_b),u_sdfgamma:new t.Uniform1f(e,i.u_sdfgamma),u_image:new t.Uniform1i(e,i.u_image),u_tex_y_a:new t.Uniform1f(e,i.u_tex_y_a),u_tex_y_b:new t.Uniform1f(e,i.u_tex_y_b),u_mix:new t.Uniform1f(e,i.u_mix)}},raster:function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_tl_parent:new t.Uniform2f(e,i.u_tl_parent),u_scale_parent:new t.Uniform1f(e,i.u_scale_parent),u_buffer_scale:new t.Uniform1f(e,i.u_buffer_scale),u_fade_t:new t.Uniform1f(e,i.u_fade_t),u_opacity:new t.Uniform1f(e,i.u_opacity),u_image0:new t.Uniform1i(e,i.u_image0),u_image1:new t.Uniform1i(e,i.u_image1),u_brightness_low:new t.Uniform1f(e,i.u_brightness_low),u_brightness_high:new t.Uniform1f(e,i.u_brightness_high),u_saturation_factor:new t.Uniform1f(e,i.u_saturation_factor),u_contrast_factor:new t.Uniform1f(e,i.u_contrast_factor),u_spin_weights:new t.Uniform3f(e,i.u_spin_weights)}},symbolIcon:function(e,i){return {u_is_size_zoom_constant:new t.Uniform1i(e,i.u_is_size_zoom_constant),u_is_size_feature_constant:new t.Uniform1i(e,i.u_is_size_feature_constant),u_size_t:new t.Uniform1f(e,i.u_size_t),u_size:new t.Uniform1f(e,i.u_size),u_camera_to_center_distance:new t.Uniform1f(e,i.u_camera_to_center_distance),u_pitch:new t.Uniform1f(e,i.u_pitch),u_rotate_symbol:new t.Uniform1i(e,i.u_rotate_symbol),u_aspect_ratio:new t.Uniform1f(e,i.u_aspect_ratio),u_fade_change:new t.Uniform1f(e,i.u_fade_change),u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_label_plane_matrix:new t.UniformMatrix4f(e,i.u_label_plane_matrix),u_gl_coord_matrix:new t.UniformMatrix4f(e,i.u_gl_coord_matrix),u_is_text:new t.Uniform1f(e,i.u_is_text),u_pitch_with_map:new t.Uniform1i(e,i.u_pitch_with_map),u_texsize:new t.Uniform2f(e,i.u_texsize),u_texture:new t.Uniform1i(e,i.u_texture)}},symbolSDF:function(e,i){return {u_is_size_zoom_constant:new t.Uniform1i(e,i.u_is_size_zoom_constant),u_is_size_feature_constant:new t.Uniform1i(e,i.u_is_size_feature_constant),u_size_t:new t.Uniform1f(e,i.u_size_t),u_size:new t.Uniform1f(e,i.u_size),u_camera_to_center_distance:new t.Uniform1f(e,i.u_camera_to_center_distance),u_pitch:new t.Uniform1f(e,i.u_pitch),u_rotate_symbol:new t.Uniform1i(e,i.u_rotate_symbol),u_aspect_ratio:new t.Uniform1f(e,i.u_aspect_ratio),u_fade_change:new t.Uniform1f(e,i.u_fade_change),u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_label_plane_matrix:new t.UniformMatrix4f(e,i.u_label_plane_matrix),u_gl_coord_matrix:new t.UniformMatrix4f(e,i.u_gl_coord_matrix),u_is_text:new t.Uniform1f(e,i.u_is_text),u_pitch_with_map:new t.Uniform1i(e,i.u_pitch_with_map),u_texsize:new t.Uniform2f(e,i.u_texsize),u_texture:new t.Uniform1i(e,i.u_texture),u_gamma_scale:new t.Uniform1f(e,i.u_gamma_scale),u_is_halo:new t.Uniform1f(e,i.u_is_halo)}},background:function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_opacity:new t.Uniform1f(e,i.u_opacity),u_color:new t.UniformColor(e,i.u_color)}},backgroundPattern:function(e,i){return {u_matrix:new t.UniformMatrix4f(e,i.u_matrix),u_opacity:new t.Uniform1f(e,i.u_opacity),u_image:new t.Uniform1i(e,i.u_image),u_pattern_tl_a:new t.Uniform2f(e,i.u_pattern_tl_a),u_pattern_br_a:new t.Uniform2f(e,i.u_pattern_br_a),u_pattern_tl_b:new t.Uniform2f(e,i.u_pattern_tl_b),u_pattern_br_b:new t.Uniform2f(e,i.u_pattern_br_b),u_texsize:new t.Uniform2f(e,i.u_texsize),u_mix:new t.Uniform1f(e,i.u_mix),u_pattern_size_a:new t.Uniform2f(e,i.u_pattern_size_a),u_pattern_size_b:new t.Uniform2f(e,i.u_pattern_size_b),u_scale_a:new t.Uniform1f(e,i.u_scale_a),u_scale_b:new t.Uniform1f(e,i.u_scale_b),u_pixel_coord_upper:new t.Uniform2f(e,i.u_pixel_coord_upper),u_pixel_coord_lower:new t.Uniform2f(e,i.u_pixel_coord_lower),u_tile_units_to_pixels:new t.Uniform1f(e,i.u_tile_units_to_pixels)}}};function Ci(e,i){for(var n=e.sort(function(t,e){return t.tileID.isLessThan(e.tileID)?-1:e.tileID.isLessThan(t.tileID)?1:0}),o=0;o<n.length;o++){var r={},a=n[o],s=n.slice(o+1);zi(a.tileID.wrapped(),a.tileID,s,new t.OverscaledTileID(0,a.tileID.wrap+1,0,0,0),r),a.setMask(r,i);}}function zi(e,i,n,o,r){for(var a=0;a<n.length;a++){var s=n[a];if(o.isLessThan(s.tileID))break;if(i.key===s.tileID.key)return;if(s.tileID.isChildOf(i)){for(var l=i.children(1/0),c=0;c<l.length;c++){zi(e,l[c],n.slice(a),o,r);}return}}var h=i.overscaledZ-e.overscaledZ,u=new t.CanonicalTileID(h,i.canonical.x-(e.canonical.x<<h),i.canonical.y-(e.canonical.y<<h));r[u.key]=r[u.key]||u;}function Pi(t,e,i,n,o){for(var r=t.context,a=r.gl,s=o?t.useProgram("collisionCircle"):t.useProgram("collisionBox"),l=0;l<n.length;l++){var c=n[l],h=e.getTile(c),u=h.getBucket(i);if(u){var p=o?u.collisionCircle:u.collisionBox;p&&s.draw(r,o?a.TRIANGLES:a.LINES,Dt.disabled,Mt.disabled,t.colorModeForRenderPass(),li(c.posMatrix,t.transform,h),i.id,p.layoutVertexBuffer,p.indexBuffer,p.segments,null,t.transform.zoom,null,null,p.collisionVertexBuffer);}}}var Ri=t.identity(new Float32Array(16)),Ai=t.properties.layout;function Li(e,i,n,o,r,a,s,l,c,h,u,p){for(var d,_,f=e.context,m=f.gl,g=e.transform,v="map"===l,y="map"===c,x=v&&"point"!==n.layout.get("symbol-placement"),b=v&&!y&&!x,w=y?e.depthModeForSublayer(0,Dt.ReadOnly):Dt.disabled,E=0,T=o;E<T.length;E+=1){var S=T[E],I=i.getTile(S),C=I.getBucket(n);if(C){var z=r?C.text:C.icon;if(z&&z.segments.get().length){var P=z.programConfigurations.get(n.id),R=r||C.sdfIcons,A=r?C.textSizeData:C.iconSizeData;d||(d=e.useProgram(R?"symbolSDF":"symbolIcon",P),_=t.evaluateSizeForZoom(A,g.zoom,Ai.properties[r?"text-size":"icon-size"])),f.activeTexture.set(m.TEXTURE0);var L=void 0;if(r)I.glyphAtlasTexture.bind(m.LINEAR,m.CLAMP_TO_EDGE),L=I.glyphAtlasTexture.size;else{var D=1!==n.layout.get("icon-size").constantOr(0)||C.iconsNeedLinear,M=y||0!==g.pitch;I.imageAtlasTexture.bind(R||e.options.rotating||e.options.zooming||D||M?m.LINEAR:m.NEAREST,m.CLAMP_TO_EDGE),L=I.imageAtlasTexture.size;}var k=ve(I,1,e.transform.zoom),B=ne(S.posMatrix,y,v,e.transform,k),O=oe(S.posMatrix,y,v,e.transform,k);x&&se(C,S.posMatrix,e,r,B,O,y,h);var F=e.translatePosMatrix(S.posMatrix,I,a,s),U=x?Ri:B,N=e.translatePosMatrix(O,I,a,s,!0),Z=void 0;if(R){var q=0!==n.paint.get(r?"text-halo-width":"icon-halo-width").constantOr(1);Z=Ei(A.functionType,_,b,y,e,F,U,N,r,L,!0),q&&Di(z,n,e,d,w,u,p,Z),Z.u_is_halo=0;}else Z=wi(A.functionType,_,b,y,e,F,U,N,r,L);Di(z,n,e,d,w,u,p,Z);}}}}function Di(t,e,i,n,o,r,a,s){var l=i.context,c=l.gl;n.draw(l,c.TRIANGLES,o,r,a,s,e.id,t.layoutVertexBuffer,t.indexBuffer,t.segments,e.paint,i.transform.zoom,t.programConfigurations.get(e.id),t.dynamicLayoutVertexBuffer,t.opacityVertexBuffer);}function Mi(t,e,i,n,o,r,a){var s,l,c,h,u,p=t.context.gl,d=i.paint.get("fill-pattern"),_=d&&d.constantOr(1),f=i.getCrossfadeParameters();a?(l=_&&!i.getPaintProperty("fill-outline-color")?"fillOutlinePattern":"fillOutline",s=p.LINES):(l=_?"fillPattern":"fill",s=p.TRIANGLES);for(var m=0,g=n;m<g.length;m+=1){var v=g[m],y=e.getTile(v);if(!_||y.patternsLoaded()){var x=y.getBucket(i);if(x){var b=x.programConfigurations.get(i.id),w=t.useProgram(l,b);_&&(t.context.activeTexture.set(p.TEXTURE0),y.imageAtlasTexture.bind(p.LINEAR,p.CLAMP_TO_EDGE),b.updatePatternPaintBuffers(f));var E=d.constantOr(null);if(E&&y.imageAtlas){var T=y.imageAtlas.patternPositions[E.to],S=y.imageAtlas.patternPositions[E.from];T&&S&&b.setConstantPatternPositions(T,S);}var I=t.translatePosMatrix(v.posMatrix,y,i.paint.get("fill-translate"),i.paint.get("fill-translate-anchor"));if(a){h=x.indexBuffer2,u=x.segments2;var C=[p.drawingBufferWidth,p.drawingBufferHeight];c="fillOutlinePattern"===l&&_?ri(I,t,f,y,C):oi(I,C);}else h=x.indexBuffer,u=x.segments,c=_?ni(I,t,f,y):ii(I);w.draw(t.context,s,o,t.stencilModeForClipping(v),r,c,i.id,x.layoutVertexBuffer,h,u,i.paint,t.transform.zoom,b);}}}}function ki(t,e,i,n,o,r){var a=t.context,s=a.gl,l=e.fbo;if(l){var c=t.useProgram("hillshade");a.activeTexture.set(s.TEXTURE0),s.bindTexture(s.TEXTURE_2D,l.colorAttachment.get());var h=di(t,e,i);e.maskedBoundsBuffer&&e.maskedIndexBuffer&&e.segments?c.draw(a,s.TRIANGLES,n,o,r,h,i.id,e.maskedBoundsBuffer,e.maskedIndexBuffer,e.segments):c.draw(a,s.TRIANGLES,n,o,r,h,i.id,t.rasterBoundsBuffer,t.quadTriangleIndexBuffer,t.rasterBoundsSegments);}}function Bi(e,i,n,o,r,a,s){var l=e.context,c=l.gl;if(i.dem&&i.dem.data){var h=i.dem.dim,u=i.dem.getPixels();if(l.activeTexture.set(c.TEXTURE1),l.pixelStoreUnpackPremultiplyAlpha.set(!1),i.demTexture=i.demTexture||e.getTileTexture(i.tileSize),i.demTexture){var p=i.demTexture;p.update(u,{premultiply:!1}),p.bind(c.NEAREST,c.CLAMP_TO_EDGE);}else i.demTexture=new t.Texture(l,u,c.RGBA,{premultiply:!1}),i.demTexture.bind(c.NEAREST,c.CLAMP_TO_EDGE);l.activeTexture.set(c.TEXTURE0);var d=i.fbo;if(!d){var _=new t.Texture(l,{width:h,height:h,data:null},c.RGBA);_.bind(c.LINEAR,c.CLAMP_TO_EDGE),(d=i.fbo=l.createFramebuffer(h,h)).colorAttachment.set(_.texture);}l.bindFramebuffer.set(d.framebuffer),l.viewport.set([0,0,h,h]),e.useProgram("hillshadePrepare").draw(l,c.TRIANGLES,r,a,s,_i(i,o),n.id,e.rasterBoundsBuffer,e.quadTriangleIndexBuffer,e.rasterBoundsSegments),i.needsHillshadePrepare=!1;}}function Oi(e,i,n,o,r){var a=o.paint.get("raster-fade-duration");if(a>0){var s=t.browser.now(),l=(s-e.timeAdded)/a,c=i?(s-i.timeAdded)/a:-1,h=n.getSource(),u=r.coveringZoomLevel({tileSize:h.tileSize,roundZoom:h.roundZoom}),p=!i||Math.abs(i.tileID.overscaledZ-u)>Math.abs(e.tileID.overscaledZ-u),d=p&&e.refreshedUponExpiration?1:t.clamp(p?l:1-c,0,1);return e.refreshedUponExpiration&&l>=1&&(e.refreshedUponExpiration=!1),i?{opacity:1,mix:1-d}:{opacity:d,mix:0}}return {opacity:1,mix:0}}function Fi(e,i,n){var o=e.context,r=o.gl,a=n.posMatrix,s=e.useProgram("debug"),l=Dt.disabled,c=Mt.disabled,h=e.colorModeForRenderPass(),u="$debug";s.draw(o,r.LINE_STRIP,l,c,h,ci(a,t.Color.red),u,e.debugBuffer,e.tileBorderIndexBuffer,e.debugSegments);for(var p=function(t,e,i,n){n=n||1;var o,r,a,s,l,c,h,u,p=[];for(o=0,r=t.length;o<r;o++)if(l=Ui[t[o]]){for(u=null,a=0,s=l[1].length;a<s;a+=2)-1===l[1][a]&&-1===l[1][a+1]?u=null:(c=e+l[1][a]*n,h=i-l[1][a+1]*n,u&&p.push(u.x,u.y,c,h),u={x:c,y:h});e+=l[0]*n;}return p}(n.toString(),50,200,5),d=new t.StructArrayLayout2i4,_=new t.StructArrayLayout2ui4,f=0;f<p.length;f+=2)d.emplaceBack(p[f],p[f+1]),_.emplaceBack(f,f+1);for(var m=o.createVertexBuffer(d,je.members),g=o.createIndexBuffer(_),v=t.SegmentVector.simpleSegment(0,0,d.length/2,d.length/2),y=i.getTile(n).tileSize,x=t.EXTENT/(Math.pow(2,e.transform.zoom-n.overscaledZ)*y),b=[[-1,-1],[-1,1],[1,-1],[1,1]],w=0;w<b.length;w++){var E=b[w];s.draw(o,r.LINES,l,c,h,ci(t.translate([],a,[x*E[0],x*E[1],0]),t.Color.white),u,m,g,v);}s.draw(o,r.LINES,l,c,h,ci(a,t.Color.black),u,m,g,v);}var Ui={" ":[16,[]],"!":[10,[5,21,5,7,-1,-1,5,2,4,1,5,0,6,1,5,2]],'"':[16,[4,21,4,14,-1,-1,12,21,12,14]],"#":[21,[11,25,4,-7,-1,-1,17,25,10,-7,-1,-1,4,12,18,12,-1,-1,3,6,17,6]],$:[20,[8,25,8,-4,-1,-1,12,25,12,-4,-1,-1,17,18,15,20,12,21,8,21,5,20,3,18,3,16,4,14,5,13,7,12,13,10,15,9,16,8,17,6,17,3,15,1,12,0,8,0,5,1,3,3]],"%":[24,[21,21,3,0,-1,-1,8,21,10,19,10,17,9,15,7,14,5,14,3,16,3,18,4,20,6,21,8,21,10,20,13,19,16,19,19,20,21,21,-1,-1,17,7,15,6,14,4,14,2,16,0,18,0,20,1,21,3,21,5,19,7,17,7]],"&":[26,[23,12,23,13,22,14,21,14,20,13,19,11,17,6,15,3,13,1,11,0,7,0,5,1,4,2,3,4,3,6,4,8,5,9,12,13,13,14,14,16,14,18,13,20,11,21,9,20,8,18,8,16,9,13,11,10,16,3,18,1,20,0,22,0,23,1,23,2]],"'":[10,[5,19,4,20,5,21,6,20,6,18,5,16,4,15]],"(":[14,[11,25,9,23,7,20,5,16,4,11,4,7,5,2,7,-2,9,-5,11,-7]],")":[14,[3,25,5,23,7,20,9,16,10,11,10,7,9,2,7,-2,5,-5,3,-7]],"*":[16,[8,21,8,9,-1,-1,3,18,13,12,-1,-1,13,18,3,12]],"+":[26,[13,18,13,0,-1,-1,4,9,22,9]],",":[10,[6,1,5,0,4,1,5,2,6,1,6,-1,5,-3,4,-4]],"-":[26,[4,9,22,9]],".":[10,[5,2,4,1,5,0,6,1,5,2]],"/":[22,[20,25,2,-7]],0:[20,[9,21,6,20,4,17,3,12,3,9,4,4,6,1,9,0,11,0,14,1,16,4,17,9,17,12,16,17,14,20,11,21,9,21]],1:[20,[6,17,8,18,11,21,11,0]],2:[20,[4,16,4,17,5,19,6,20,8,21,12,21,14,20,15,19,16,17,16,15,15,13,13,10,3,0,17,0]],3:[20,[5,21,16,21,10,13,13,13,15,12,16,11,17,8,17,6,16,3,14,1,11,0,8,0,5,1,4,2,3,4]],4:[20,[13,21,3,7,18,7,-1,-1,13,21,13,0]],5:[20,[15,21,5,21,4,12,5,13,8,14,11,14,14,13,16,11,17,8,17,6,16,3,14,1,11,0,8,0,5,1,4,2,3,4]],6:[20,[16,18,15,20,12,21,10,21,7,20,5,17,4,12,4,7,5,3,7,1,10,0,11,0,14,1,16,3,17,6,17,7,16,10,14,12,11,13,10,13,7,12,5,10,4,7]],7:[20,[17,21,7,0,-1,-1,3,21,17,21]],8:[20,[8,21,5,20,4,18,4,16,5,14,7,13,11,12,14,11,16,9,17,7,17,4,16,2,15,1,12,0,8,0,5,1,4,2,3,4,3,7,4,9,6,11,9,12,13,13,15,14,16,16,16,18,15,20,12,21,8,21]],9:[20,[16,14,15,11,13,9,10,8,9,8,6,9,4,11,3,14,3,15,4,18,6,20,9,21,10,21,13,20,15,18,16,14,16,9,15,4,13,1,10,0,8,0,5,1,4,3]],":":[10,[5,14,4,13,5,12,6,13,5,14,-1,-1,5,2,4,1,5,0,6,1,5,2]],";":[10,[5,14,4,13,5,12,6,13,5,14,-1,-1,6,1,5,0,4,1,5,2,6,1,6,-1,5,-3,4,-4]],"<":[24,[20,18,4,9,20,0]],"=":[26,[4,12,22,12,-1,-1,4,6,22,6]],">":[24,[4,18,20,9,4,0]],"?":[18,[3,16,3,17,4,19,5,20,7,21,11,21,13,20,14,19,15,17,15,15,14,13,13,12,9,10,9,7,-1,-1,9,2,8,1,9,0,10,1,9,2]],"@":[27,[18,13,17,15,15,16,12,16,10,15,9,14,8,11,8,8,9,6,11,5,14,5,16,6,17,8,-1,-1,12,16,10,14,9,11,9,8,10,6,11,5,-1,-1,18,16,17,8,17,6,19,5,21,5,23,7,24,10,24,12,23,15,22,17,20,19,18,20,15,21,12,21,9,20,7,19,5,17,4,15,3,12,3,9,4,6,5,4,7,2,9,1,12,0,15,0,18,1,20,2,21,3,-1,-1,19,16,18,8,18,6,19,5]],A:[18,[9,21,1,0,-1,-1,9,21,17,0,-1,-1,4,7,14,7]],B:[21,[4,21,4,0,-1,-1,4,21,13,21,16,20,17,19,18,17,18,15,17,13,16,12,13,11,-1,-1,4,11,13,11,16,10,17,9,18,7,18,4,17,2,16,1,13,0,4,0]],C:[21,[18,16,17,18,15,20,13,21,9,21,7,20,5,18,4,16,3,13,3,8,4,5,5,3,7,1,9,0,13,0,15,1,17,3,18,5]],D:[21,[4,21,4,0,-1,-1,4,21,11,21,14,20,16,18,17,16,18,13,18,8,17,5,16,3,14,1,11,0,4,0]],E:[19,[4,21,4,0,-1,-1,4,21,17,21,-1,-1,4,11,12,11,-1,-1,4,0,17,0]],F:[18,[4,21,4,0,-1,-1,4,21,17,21,-1,-1,4,11,12,11]],G:[21,[18,16,17,18,15,20,13,21,9,21,7,20,5,18,4,16,3,13,3,8,4,5,5,3,7,1,9,0,13,0,15,1,17,3,18,5,18,8,-1,-1,13,8,18,8]],H:[22,[4,21,4,0,-1,-1,18,21,18,0,-1,-1,4,11,18,11]],I:[8,[4,21,4,0]],J:[16,[12,21,12,5,11,2,10,1,8,0,6,0,4,1,3,2,2,5,2,7]],K:[21,[4,21,4,0,-1,-1,18,21,4,7,-1,-1,9,12,18,0]],L:[17,[4,21,4,0,-1,-1,4,0,16,0]],M:[24,[4,21,4,0,-1,-1,4,21,12,0,-1,-1,20,21,12,0,-1,-1,20,21,20,0]],N:[22,[4,21,4,0,-1,-1,4,21,18,0,-1,-1,18,21,18,0]],O:[22,[9,21,7,20,5,18,4,16,3,13,3,8,4,5,5,3,7,1,9,0,13,0,15,1,17,3,18,5,19,8,19,13,18,16,17,18,15,20,13,21,9,21]],P:[21,[4,21,4,0,-1,-1,4,21,13,21,16,20,17,19,18,17,18,14,17,12,16,11,13,10,4,10]],Q:[22,[9,21,7,20,5,18,4,16,3,13,3,8,4,5,5,3,7,1,9,0,13,0,15,1,17,3,18,5,19,8,19,13,18,16,17,18,15,20,13,21,9,21,-1,-1,12,4,18,-2]],R:[21,[4,21,4,0,-1,-1,4,21,13,21,16,20,17,19,18,17,18,15,17,13,16,12,13,11,4,11,-1,-1,11,11,18,0]],S:[20,[17,18,15,20,12,21,8,21,5,20,3,18,3,16,4,14,5,13,7,12,13,10,15,9,16,8,17,6,17,3,15,1,12,0,8,0,5,1,3,3]],T:[16,[8,21,8,0,-1,-1,1,21,15,21]],U:[22,[4,21,4,6,5,3,7,1,10,0,12,0,15,1,17,3,18,6,18,21]],V:[18,[1,21,9,0,-1,-1,17,21,9,0]],W:[24,[2,21,7,0,-1,-1,12,21,7,0,-1,-1,12,21,17,0,-1,-1,22,21,17,0]],X:[20,[3,21,17,0,-1,-1,17,21,3,0]],Y:[18,[1,21,9,11,9,0,-1,-1,17,21,9,11]],Z:[20,[17,21,3,0,-1,-1,3,21,17,21,-1,-1,3,0,17,0]],"[":[14,[4,25,4,-7,-1,-1,5,25,5,-7,-1,-1,4,25,11,25,-1,-1,4,-7,11,-7]],"\\":[14,[0,21,14,-3]],"]":[14,[9,25,9,-7,-1,-1,10,25,10,-7,-1,-1,3,25,10,25,-1,-1,3,-7,10,-7]],"^":[16,[6,15,8,18,10,15,-1,-1,3,12,8,17,13,12,-1,-1,8,17,8,0]],_:[16,[0,-2,16,-2]],"`":[10,[6,21,5,20,4,18,4,16,5,15,6,16,5,17]],a:[19,[15,14,15,0,-1,-1,15,11,13,13,11,14,8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3]],b:[19,[4,21,4,0,-1,-1,4,11,6,13,8,14,11,14,13,13,15,11,16,8,16,6,15,3,13,1,11,0,8,0,6,1,4,3]],c:[18,[15,11,13,13,11,14,8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3]],d:[19,[15,21,15,0,-1,-1,15,11,13,13,11,14,8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3]],e:[18,[3,8,15,8,15,10,14,12,13,13,11,14,8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3]],f:[12,[10,21,8,21,6,20,5,17,5,0,-1,-1,2,14,9,14]],g:[19,[15,14,15,-2,14,-5,13,-6,11,-7,8,-7,6,-6,-1,-1,15,11,13,13,11,14,8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3]],h:[19,[4,21,4,0,-1,-1,4,10,7,13,9,14,12,14,14,13,15,10,15,0]],i:[8,[3,21,4,20,5,21,4,22,3,21,-1,-1,4,14,4,0]],j:[10,[5,21,6,20,7,21,6,22,5,21,-1,-1,6,14,6,-3,5,-6,3,-7,1,-7]],k:[17,[4,21,4,0,-1,-1,14,14,4,4,-1,-1,8,8,15,0]],l:[8,[4,21,4,0]],m:[30,[4,14,4,0,-1,-1,4,10,7,13,9,14,12,14,14,13,15,10,15,0,-1,-1,15,10,18,13,20,14,23,14,25,13,26,10,26,0]],n:[19,[4,14,4,0,-1,-1,4,10,7,13,9,14,12,14,14,13,15,10,15,0]],o:[19,[8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3,16,6,16,8,15,11,13,13,11,14,8,14]],p:[19,[4,14,4,-7,-1,-1,4,11,6,13,8,14,11,14,13,13,15,11,16,8,16,6,15,3,13,1,11,0,8,0,6,1,4,3]],q:[19,[15,14,15,-7,-1,-1,15,11,13,13,11,14,8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3]],r:[13,[4,14,4,0,-1,-1,4,8,5,11,7,13,9,14,12,14]],s:[17,[14,11,13,13,10,14,7,14,4,13,3,11,4,9,6,8,11,7,13,6,14,4,14,3,13,1,10,0,7,0,4,1,3,3]],t:[12,[5,21,5,4,6,1,8,0,10,0,-1,-1,2,14,9,14]],u:[19,[4,14,4,4,5,1,7,0,10,0,12,1,15,4,-1,-1,15,14,15,0]],v:[16,[2,14,8,0,-1,-1,14,14,8,0]],w:[22,[3,14,7,0,-1,-1,11,14,7,0,-1,-1,11,14,15,0,-1,-1,19,14,15,0]],x:[17,[3,14,14,0,-1,-1,14,14,3,0]],y:[16,[2,14,8,0,-1,-1,14,14,8,0,6,-4,4,-6,2,-7,1,-7]],z:[17,[14,14,3,0,-1,-1,3,14,14,14,-1,-1,3,0,14,0]],"{":[14,[9,25,7,24,6,23,5,21,5,19,6,17,7,16,8,14,8,12,6,10,-1,-1,7,24,6,22,6,20,7,18,8,17,9,15,9,13,8,11,4,9,8,7,9,5,9,3,8,1,7,0,6,-2,6,-4,7,-6,-1,-1,6,8,8,6,8,4,7,2,6,1,5,-1,5,-3,6,-5,7,-6,9,-7]],"|":[8,[4,25,4,-7]],"}":[14,[5,25,7,24,8,23,9,21,9,19,8,17,7,16,6,14,6,12,8,10,-1,-1,7,24,8,22,8,20,7,18,6,17,5,15,5,13,6,11,10,9,6,7,5,5,5,3,6,1,7,0,8,-2,8,-4,7,-6,-1,-1,8,8,6,6,6,4,7,2,8,1,9,-1,9,-3,8,-5,7,-6,5,-7]],"~":[24,[3,6,3,8,4,11,6,12,8,12,10,11,14,8,16,7,18,7,20,8,21,10,-1,-1,3,8,4,10,6,11,8,11,10,10,14,7,16,6,18,6,20,7,21,10,21,12]]};var Ni={symbol:function(t,e,i,n){if("translucent"===t.renderPass){var o=Mt.disabled,r=t.colorModeForRenderPass();0!==i.paint.get("icon-opacity").constantOr(1)&&Li(t,e,i,n,!1,i.paint.get("icon-translate"),i.paint.get("icon-translate-anchor"),i.layout.get("icon-rotation-alignment"),i.layout.get("icon-pitch-alignment"),i.layout.get("icon-keep-upright"),o,r),0!==i.paint.get("text-opacity").constantOr(1)&&Li(t,e,i,n,!0,i.paint.get("text-translate"),i.paint.get("text-translate-anchor"),i.layout.get("text-rotation-alignment"),i.layout.get("text-pitch-alignment"),i.layout.get("text-keep-upright"),o,r),e.map.showCollisionBoxes&&function(t,e,i,n){Pi(t,e,i,n,!1),Pi(t,e,i,n,!0);}(t,e,i,n);}},circle:function(t,e,i,n){if("translucent"===t.renderPass){var o=i.paint.get("circle-opacity"),r=i.paint.get("circle-stroke-width"),a=i.paint.get("circle-stroke-opacity");if(0!==o.constantOr(1)||0!==r.constantOr(1)&&0!==a.constantOr(1))for(var s=t.context,l=s.gl,c=t.depthModeForSublayer(0,Dt.ReadOnly),h=Mt.disabled,u=t.colorModeForRenderPass(),p=0;p<n.length;p++){var d=n[p],_=e.getTile(d),f=_.getBucket(i);if(f){var m=f.programConfigurations.get(i.id);t.useProgram("circle",m).draw(s,l.TRIANGLES,c,h,u,ai(t,d,_,i),i.id,f.layoutVertexBuffer,f.indexBuffer,f.segments,i.paint,t.transform.zoom,m);}}}},heatmap:function(e,i,n,o){if(0!==n.paint.get("heatmap-opacity"))if("offscreen"===e.renderPass){var r=e.context,a=r.gl,s=e.depthModeForSublayer(0,Dt.ReadOnly),l=Mt.disabled,c=new kt([a.ONE,a.ONE],t.Color.transparent,[!0,!0,!0,!0]);!function(t,e,i){var n=t.gl;t.activeTexture.set(n.TEXTURE1),t.viewport.set([0,0,e.width/4,e.height/4]);var o=i.heatmapFbo;if(o)n.bindTexture(n.TEXTURE_2D,o.colorAttachment.get()),t.bindFramebuffer.set(o.framebuffer);else{var r=n.createTexture();n.bindTexture(n.TEXTURE_2D,r),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,n.LINEAR),o=i.heatmapFbo=t.createFramebuffer(e.width/4,e.height/4),function t(e,i,n,o){var r=e.gl;r.texImage2D(r.TEXTURE_2D,0,r.RGBA,i.width/4,i.height/4,0,r.RGBA,e.extTextureHalfFloat?e.extTextureHalfFloat.HALF_FLOAT_OES:r.UNSIGNED_BYTE,null),o.colorAttachment.set(n),e.extTextureHalfFloat&&r.checkFramebufferStatus(r.FRAMEBUFFER)!==r.FRAMEBUFFER_COMPLETE&&(e.extTextureHalfFloat=null,o.colorAttachment.setDirty(),t(e,i,n,o));}(t,e,r,o);}}(r,e,n),r.clear({color:t.Color.transparent});for(var h=0;h<o.length;h++){var u=o[h];if(!i.hasRenderableParent(u)){var p=i.getTile(u),d=p.getBucket(n);if(d){var _=d.programConfigurations.get(n.id),f=e.useProgram("heatmap",_),m=e.transform.zoom;f.draw(r,a.TRIANGLES,s,l,c,ui(u.posMatrix,p,m,n.paint.get("heatmap-intensity")),n.id,d.layoutVertexBuffer,d.indexBuffer,d.segments,n.paint,e.transform.zoom,_);}}}r.viewport.set([0,0,e.width,e.height]);}else"translucent"===e.renderPass&&(e.context.setColorMode(e.colorModeForRenderPass()),function(e,i){var n=e.context,o=n.gl,r=i.heatmapFbo;if(r){n.activeTexture.set(o.TEXTURE0),o.bindTexture(o.TEXTURE_2D,r.colorAttachment.get()),n.activeTexture.set(o.TEXTURE1);var a=i.colorRampTexture;a||(a=i.colorRampTexture=new t.Texture(n,i.colorRamp,o.RGBA)),a.bind(o.LINEAR,o.CLAMP_TO_EDGE),e.useProgram("heatmapTexture").draw(n,o.TRIANGLES,Dt.disabled,Mt.disabled,e.colorModeForRenderPass(),pi(e,i,0,1),i.id,e.viewportBuffer,e.quadTriangleIndexBuffer,e.viewportSegments,i.paint,e.transform.zoom);}}(e,n));},line:function(e,i,n,o){if("translucent"===e.renderPass){var r=n.paint.get("line-opacity"),a=n.paint.get("line-width");if(0!==r.constantOr(1)&&0!==a.constantOr(1)){var s=e.depthModeForSublayer(0,Dt.ReadOnly),l=e.colorModeForRenderPass(),c=n.paint.get("line-dasharray"),h=n.paint.get("line-pattern"),u=h.constantOr(1),p=n.paint.get("line-gradient"),d=n.getCrossfadeParameters(),_=c?"lineSDF":u?"linePattern":p?"lineGradient":"line",f=e.context,m=f.gl,g=!0;if(p){f.activeTexture.set(m.TEXTURE0);var v=n.gradientTexture;if(!n.gradient)return;v||(v=n.gradientTexture=new t.Texture(f,n.gradient,m.RGBA)),v.bind(m.LINEAR,m.CLAMP_TO_EDGE);}for(var y=0,x=o;y<x.length;y+=1){var b=x[y],w=i.getTile(b);if(!u||w.patternsLoaded()){var E=w.getBucket(n);if(E){var T=E.programConfigurations.get(n.id),S=e.context.program.get(),I=e.useProgram(_,T),C=g||I.program!==S,z=h.constantOr(null);if(z&&w.imageAtlas){var P=w.imageAtlas.patternPositions[z.to],R=w.imageAtlas.patternPositions[z.from];P&&R&&T.setConstantPatternPositions(P,R);}var A=c?vi(e,w,n,c,d):u?gi(e,w,n,d):p?mi(e,w,n):fi(e,w,n);c&&(C||e.lineAtlas.dirty)?(f.activeTexture.set(m.TEXTURE0),e.lineAtlas.bind(f)):u&&(f.activeTexture.set(m.TEXTURE0),w.imageAtlasTexture.bind(m.LINEAR,m.CLAMP_TO_EDGE),T.updatePatternPaintBuffers(d)),I.draw(f,m.TRIANGLES,s,e.stencilModeForClipping(b),l,A,n.id,E.layoutVertexBuffer,E.indexBuffer,E.segments,n.paint,e.transform.zoom,T),g=!1;}}}}}},fill:function(e,i,n,o){var r=n.paint.get("fill-color"),a=n.paint.get("fill-opacity");if(0!==a.constantOr(1)){var s=e.colorModeForRenderPass(),l=n.paint.get("fill-pattern").constantOr(1)||1!==r.constantOr(t.Color.transparent).a||1!==a.constantOr(0)?"translucent":"opaque";e.renderPass===l&&Mi(e,i,n,o,e.depthModeForSublayer(1,"opaque"===e.renderPass?Dt.ReadWrite:Dt.ReadOnly),s,!1),"translucent"===e.renderPass&&n.paint.get("fill-antialias")&&Mi(e,i,n,o,e.depthModeForSublayer(n.getPaintProperty("fill-outline-color")?2:0,Dt.ReadOnly),s,!0);}},"fill-extrusion":function(e,i,n,o){0!==n.paint.get("fill-extrusion-opacity")&&("offscreen"===e.renderPass?(function(e,i){var n=e.context,o=n.gl,r=i.viewportFrame;if(e.depthRboNeedsClear&&e.setupOffscreenDepthRenderbuffer(),!r){var a=new t.Texture(n,{width:e.width,height:e.height,data:null},o.RGBA);a.bind(o.LINEAR,o.CLAMP_TO_EDGE),(r=i.viewportFrame=n.createFramebuffer(e.width,e.height)).colorAttachment.set(a.texture);}n.bindFramebuffer.set(r.framebuffer),r.depthAttachment.set(e.depthRbo),e.depthRboNeedsClear&&(n.clear({depth:1}),e.depthRboNeedsClear=!1),n.clear({color:t.Color.transparent});}(e,n),function(t,e,i,n,o,r,a){for(var s=t.context,l=s.gl,c=i.paint.get("fill-extrusion-pattern"),h=c.constantOr(1),u=i.getCrossfadeParameters(),p=0,d=n;p<d.length;p+=1){var _=d[p],f=e.getTile(_),m=f.getBucket(i);if(m){var g=m.programConfigurations.get(i.id),v=t.useProgram(h?"fillExtrusionPattern":"fillExtrusion",g);h&&(t.context.activeTexture.set(l.TEXTURE0),f.imageAtlasTexture.bind(l.LINEAR,l.CLAMP_TO_EDGE),g.updatePatternPaintBuffers(u));var y=c.constantOr(null);if(y&&f.imageAtlas){var x=f.imageAtlas.patternPositions[y.to],b=f.imageAtlas.patternPositions[y.from];x&&b&&g.setConstantPatternPositions(x,b);}var w=t.translatePosMatrix(_.posMatrix,f,i.paint.get("fill-extrusion-translate"),i.paint.get("fill-extrusion-translate-anchor")),E=h?ti(w,t,_,u,f):$e(w,t);v.draw(s,s.gl.TRIANGLES,o,r,a,E,i.id,m.layoutVertexBuffer,m.indexBuffer,m.segments,i.paint,t.transform.zoom,g);}}}(e,i,n,o,new Dt(e.context.gl.LEQUAL,Dt.ReadWrite,[0,1]),Mt.disabled,e.colorModeForRenderPass())):"translucent"===e.renderPass&&function(t,e){var i=e.viewportFrame;if(i){var n=t.context,o=n.gl;n.activeTexture.set(o.TEXTURE0),o.bindTexture(o.TEXTURE_2D,i.colorAttachment.get()),t.useProgram("extrusionTexture").draw(n,o.TRIANGLES,Dt.disabled,Mt.disabled,t.colorModeForRenderPass(),ei(t,e,0),e.id,t.viewportBuffer,t.quadTriangleIndexBuffer,t.viewportSegments,e.paint,t.transform.zoom);}}(e,n));},hillshade:function(t,e,i,n){if("offscreen"===t.renderPass||"translucent"===t.renderPass){for(var o=t.context,r=e.getSource().maxzoom,a=t.depthModeForSublayer(0,Dt.ReadOnly),s=Mt.disabled,l=t.colorModeForRenderPass(),c=0,h=n;c<h.length;c+=1){var u=h[c],p=e.getTile(u);p.needsHillshadePrepare&&"offscreen"===t.renderPass?Bi(t,p,i,r,a,s,l):"translucent"===t.renderPass&&ki(t,p,i,a,s,l);}o.viewport.set([0,0,t.width,t.height]);}},raster:function(t,e,i,n){if("translucent"===t.renderPass&&0!==i.paint.get("raster-opacity"))for(var o=t.context,r=o.gl,a=e.getSource(),s=t.useProgram("raster"),l=Mt.disabled,c=t.colorModeForRenderPass(),h=n.length&&n[0].overscaledZ,u=0,p=n;u<p.length;u+=1){var d=p[u],_=t.depthModeForSublayer(d.overscaledZ-h,1===i.paint.get("raster-opacity")?Dt.ReadWrite:Dt.ReadOnly,r.LESS),f=e.getTile(d),m=t.transform.calculatePosMatrix(d.toUnwrapped(),!0);f.registerFadeDuration(i.paint.get("raster-fade-duration"));var g=e.findLoadedParent(d,0),v=Oi(f,g,e,i,t.transform),y=void 0,x=void 0,b="nearest"===i.paint.get("raster-resampling")?r.NEAREST:r.LINEAR;o.activeTexture.set(r.TEXTURE0),f.texture.bind(b,r.CLAMP_TO_EDGE,r.LINEAR_MIPMAP_NEAREST),o.activeTexture.set(r.TEXTURE1),g?(g.texture.bind(b,r.CLAMP_TO_EDGE,r.LINEAR_MIPMAP_NEAREST),y=Math.pow(2,g.tileID.overscaledZ-f.tileID.overscaledZ),x=[f.tileID.canonical.x*y%1,f.tileID.canonical.y*y%1]):f.texture.bind(b,r.CLAMP_TO_EDGE,r.LINEAR_MIPMAP_NEAREST);var w=bi(m,x||[0,0],y||1,v,i);a instanceof W?s.draw(o,r.TRIANGLES,_,l,c,w,i.id,a.boundsBuffer,t.quadTriangleIndexBuffer,a.boundsSegments):f.maskedBoundsBuffer&&f.maskedIndexBuffer&&f.segments?s.draw(o,r.TRIANGLES,_,l,c,w,i.id,f.maskedBoundsBuffer,f.maskedIndexBuffer,f.segments,i.paint,t.transform.zoom):s.draw(o,r.TRIANGLES,_,l,c,w,i.id,t.rasterBoundsBuffer,t.quadTriangleIndexBuffer,t.rasterBoundsSegments);}},background:function(t,e,i){var n=i.paint.get("background-color"),o=i.paint.get("background-opacity");if(0!==o){var r=t.context,a=r.gl,s=t.transform,l=s.tileSize,c=i.paint.get("background-pattern");if(!t.isPatternMissing(c)){var h=c||1!==n.a||1!==o?"translucent":"opaque";if(t.renderPass===h){var u=Mt.disabled,p=t.depthModeForSublayer(0,"opaque"===h?Dt.ReadWrite:Dt.ReadOnly),d=t.colorModeForRenderPass(),_=t.useProgram(c?"backgroundPattern":"background"),f=s.coveringTiles({tileSize:l});c&&(r.activeTexture.set(a.TEXTURE0),t.imageManager.bind(t.context));for(var m=i.getCrossfadeParameters(),g=0,v=f;g<v.length;g+=1){var y=v[g],x=t.transform.calculatePosMatrix(y.toUnwrapped()),b=c?Si(x,o,t,c,{tileID:y,tileSize:l},m):Ti(x,o,n);_.draw(r,a.TRIANGLES,p,u,d,b,i.id,t.tileExtentBuffer,t.quadTriangleIndexBuffer,t.tileExtentSegments);}}}}},debug:function(t,e,i){for(var n=0;n<i.length;n++)Fi(t,e,i[n]);}},Zi=function(e,i){this.context=new Bt(e),this.transform=i,this._tileTextures={},this.setup(),this.numSublayers=Ot.maxUnderzooming+Ot.maxOverzooming+1,this.depthEpsilon=1/Math.pow(2,16),this.depthRboNeedsClear=!0,this.emptyProgramConfiguration=new t.ProgramConfiguration,this.crossTileSymbolIndex=new Ue;};function qi(t,e){if(t.row>e.row){var i=t;t=e,e=i;}return {x0:t.column,y0:t.row,x1:e.column,y1:e.row,dx:e.column-t.column,dy:e.row-t.row}}function Vi(t,e,i,n,o){var r=Math.max(i,Math.floor(e.y0)),a=Math.min(n,Math.ceil(e.y1));if(t.x0===e.x0&&t.y0===e.y0?t.x0+e.dy/t.dy*t.dx<e.x1:t.x1-e.dy/t.dy*t.dx<e.x0){var s=t;t=e,e=s;}for(var l=t.dx/t.dy,c=e.dx/e.dy,h=t.dx>0,u=e.dx<0,p=r;p<a;p++){var d=l*Math.max(0,Math.min(t.dy,p+h-t.y0))+t.x0,_=c*Math.max(0,Math.min(e.dy,p+u-e.y0))+e.x0;o(Math.floor(_),Math.ceil(d),p);}}function ji(t,e,i,n,o,r){var a,s=qi(t,e),l=qi(e,i),c=qi(i,t);s.dy>l.dy&&(a=s,s=l,l=a),s.dy>c.dy&&(a=s,s=c,c=a),l.dy>c.dy&&(a=l,l=c,c=a),s.dy&&Vi(c,s,n,o,r),l.dy&&Vi(c,l,n,o,r);}Zi.prototype.resize=function(e,i){var n=this.context.gl;if(this.width=e*t.browser.devicePixelRatio,this.height=i*t.browser.devicePixelRatio,this.context.viewport.set([0,0,this.width,this.height]),this.style)for(var o=0,r=this.style._order;o<r.length;o+=1){var a=r[o];this.style._layers[a].resize();}this.depthRbo&&(n.deleteRenderbuffer(this.depthRbo),this.depthRbo=null);},Zi.prototype.setup=function(){var e=this.context,i=new t.StructArrayLayout2i4;i.emplaceBack(0,0),i.emplaceBack(t.EXTENT,0),i.emplaceBack(0,t.EXTENT),i.emplaceBack(t.EXTENT,t.EXTENT),this.tileExtentBuffer=e.createVertexBuffer(i,je.members),this.tileExtentSegments=t.SegmentVector.simpleSegment(0,0,4,2);var n=new t.StructArrayLayout2i4;n.emplaceBack(0,0),n.emplaceBack(t.EXTENT,0),n.emplaceBack(0,t.EXTENT),n.emplaceBack(t.EXTENT,t.EXTENT),this.debugBuffer=e.createVertexBuffer(n,je.members),this.debugSegments=t.SegmentVector.simpleSegment(0,0,4,5);var o=new t.StructArrayLayout4i8;o.emplaceBack(0,0,0,0),o.emplaceBack(t.EXTENT,0,t.EXTENT,0),o.emplaceBack(0,t.EXTENT,0,t.EXTENT),o.emplaceBack(t.EXTENT,t.EXTENT,t.EXTENT,t.EXTENT),this.rasterBoundsBuffer=e.createVertexBuffer(o,t.rasterBoundsAttributes.members),this.rasterBoundsSegments=t.SegmentVector.simpleSegment(0,0,4,2);var r=new t.StructArrayLayout2i4;r.emplaceBack(0,0),r.emplaceBack(1,0),r.emplaceBack(0,1),r.emplaceBack(1,1),this.viewportBuffer=e.createVertexBuffer(r,je.members),this.viewportSegments=t.SegmentVector.simpleSegment(0,0,4,2);var a=new t.StructArrayLayout1ui2;a.emplaceBack(0),a.emplaceBack(1),a.emplaceBack(3),a.emplaceBack(2),a.emplaceBack(0),this.tileBorderIndexBuffer=e.createIndexBuffer(a);var s=new t.StructArrayLayout3ui6;s.emplaceBack(0,1,2),s.emplaceBack(2,1,3),this.quadTriangleIndexBuffer=e.createIndexBuffer(s);var l=this.context.gl;this.stencilClearMode=new Mt({func:l.ALWAYS,mask:0},0,255,l.ZERO,l.ZERO,l.ZERO);},Zi.prototype.clearStencil=function(){var e=this.context,i=e.gl,n=t.create();t.ortho(n,0,this.width,this.height,0,0,1),t.scale(n,n,[i.drawingBufferWidth,i.drawingBufferHeight,0]),this.useProgram("clippingMask").draw(e,i.TRIANGLES,Dt.disabled,this.stencilClearMode,kt.disabled,hi(n),"$clipping",this.viewportBuffer,this.quadTriangleIndexBuffer,this.viewportSegments);},Zi.prototype._renderTileClippingMasks=function(t){var e=this.context,i=e.gl;e.setColorMode(kt.disabled),e.setDepthMode(Dt.disabled);var n=this.useProgram("clippingMask"),o=1;this._tileClippingMaskIDs={};for(var r=0,a=t;r<a.length;r+=1){var s=a[r],l=this._tileClippingMaskIDs[s.key]=o++;n.draw(e,i.TRIANGLES,Dt.disabled,new Mt({func:i.ALWAYS,mask:0},l,255,i.KEEP,i.KEEP,i.REPLACE),kt.disabled,hi(s.posMatrix),"$clipping",this.tileExtentBuffer,this.quadTriangleIndexBuffer,this.tileExtentSegments);}},Zi.prototype.stencilModeForClipping=function(t){var e=this.context.gl;return new Mt({func:e.EQUAL,mask:255},this._tileClippingMaskIDs[t.key],0,e.KEEP,e.KEEP,e.REPLACE)},Zi.prototype.colorModeForRenderPass=function(){var e=this.context.gl;if(this._showOverdrawInspector){return new kt([e.CONSTANT_COLOR,e.ONE],new t.Color(1/8,1/8,1/8,0),[!0,!0,!0,!0])}return "opaque"===this.renderPass?kt.unblended:kt.alphaBlended},Zi.prototype.depthModeForSublayer=function(t,e,i){var n=1-((1+this.currentLayer)*this.numSublayers+t)*this.depthEpsilon,o=n-1+this.depthRange;return new Dt(i||this.context.gl.LEQUAL,e,[o,n])},Zi.prototype.render=function(e,i){this.style=e,this.options=i,this.lineAtlas=e.lineAtlas,this.imageManager=e.imageManager,this.glyphManager=e.glyphManager,this.symbolFadeChange=e.placement.symbolFadeChange(t.browser.now());var n=this.style._order,o=this.style.sourceCaches;for(var r in o){var a=o[r];a.used&&a.prepare(this.context);}var s,l={},c={},h={};for(var u in o){var p=o[u];l[u]=p.getVisibleCoordinates(),c[u]=l[u].slice().reverse(),h[u]=p.getVisibleCoordinates(!0).reverse();}for(var d in o){var _=o[d],f=_.getSource();if("raster"===f.type||"raster-dem"===f.type){for(var m=[],g=0,v=l[d];g<v.length;g+=1){var y=v[g];m.push(_.getTile(y));}Ci(m,this.context);}}this.renderPass="offscreen",this.depthRboNeedsClear=!0;for(var x=0,b=n;x<b.length;x+=1){var w=b[x],E=this.style._layers[w];if(E.hasOffscreenPass()&&!E.isHidden(this.transform.zoom)){var T=c[E.source];T.length&&this.renderLayer(this,o[E.source],E,T);}}for(this.context.bindFramebuffer.set(null),this.context.clear({color:i.showOverdrawInspector?t.Color.black:t.Color.transparent,depth:1}),this._showOverdrawInspector=i.showOverdrawInspector,this.depthRange=(e._order.length+2)*this.numSublayers*this.depthEpsilon,this.renderPass="opaque",this.currentLayer=n.length-1;this.currentLayer>=0;this.currentLayer--){var S=this.style._layers[n[this.currentLayer]],I=o[S.source],C=l[S.source];S.source!==s&&I&&(this.clearStencil(),I.getSource().isTileClipped&&this._renderTileClippingMasks(C)),this.renderLayer(this,I,S,C),s=S.source;}for(this.renderPass="translucent",this.currentLayer=0,s=null;this.currentLayer<n.length;this.currentLayer++){var z=this.style._layers[n[this.currentLayer]],P=o[z.source],R=("symbol"===z.type?h:c)[z.source];z.source!==s&&P&&(this.clearStencil(),P.getSource().isTileClipped&&this._renderTileClippingMasks(l[z.source])),this.renderLayer(this,P,z,R),s=z.source;}if(this.options.showTileBoundaries)for(var A in o){Ni.debug(this,o[A],l[A]);break}},Zi.prototype.setupOffscreenDepthRenderbuffer=function(){var t=this.context;this.depthRbo||(this.depthRbo=t.createRenderbuffer(t.gl.DEPTH_COMPONENT16,this.width,this.height));},Zi.prototype.renderLayer=function(t,e,i,n){i.isHidden(this.transform.zoom)||("background"===i.type||n.length)&&(this.id=i.id,Ni[i.type](t,e,i,n));},Zi.prototype.translatePosMatrix=function(e,i,n,o,r){if(!n[0]&&!n[1])return e;var a=r?"map"===o?this.transform.angle:0:"viewport"===o?-this.transform.angle:0;if(a){var s=Math.sin(a),l=Math.cos(a);n=[n[0]*l-n[1]*s,n[0]*s+n[1]*l];}var c=[r?n[0]:ve(i,n[0],this.transform.zoom),r?n[1]:ve(i,n[1],this.transform.zoom),0],h=new Float32Array(16);return t.translate(h,e,c),h},Zi.prototype.saveTileTexture=function(t){var e=this._tileTextures[t.size[0]];e?e.push(t):this._tileTextures[t.size[0]]=[t];},Zi.prototype.getTileTexture=function(t){var e=this._tileTextures[t];return e&&e.length>0?e.pop():null},Zi.prototype.isPatternMissing=function(t){if(!t)return !1;var e=this.imageManager.getPattern(t.from),i=this.imageManager.getPattern(t.to);return !e||!i},Zi.prototype.useProgram=function(t,e){void 0===e&&(e=this.emptyProgramConfiguration),this.cache=this.cache||{};var i=""+t+(e.cacheKey||"")+(this._showOverdrawInspector?"/overdraw":"");return this.cache[i]||(this.cache[i]=new Je(this.context,Ke[t],e,Ii[t],this._showOverdrawInspector)),this.cache[i]};var Gi=function(t,e,i){this.tileSize=512,this.maxValidLatitude=85.051129,this._renderWorldCopies=void 0===i||i,this._minZoom=t||0,this._maxZoom=e||22,this.setMaxBounds(),this.width=0,this.height=0,this._center=new U(0,0),this.zoom=0,this.angle=0,this._fov=.6435011087932844,this._pitch=0,this._unmodified=!0,this._posMatrixCache={},this._alignedPosMatrixCache={};},Wi={minZoom:{configurable:!0},maxZoom:{configurable:!0},renderWorldCopies:{configurable:!0},worldSize:{configurable:!0},centerPoint:{configurable:!0},size:{configurable:!0},bearing:{configurable:!0},pitch:{configurable:!0},fov:{configurable:!0},zoom:{configurable:!0},center:{configurable:!0},unmodified:{configurable:!0},x:{configurable:!0},y:{configurable:!0},point:{configurable:!0}};Gi.prototype.clone=function(){var t=new Gi(this._minZoom,this._maxZoom,this._renderWorldCopies);return t.tileSize=this.tileSize,t.latRange=this.latRange,t.width=this.width,t.height=this.height,t._center=this._center,t.zoom=this.zoom,t.angle=this.angle,t._fov=this._fov,t._pitch=this._pitch,t._unmodified=this._unmodified,t._calcMatrices(),t},Wi.minZoom.get=function(){return this._minZoom},Wi.minZoom.set=function(t){this._minZoom!==t&&(this._minZoom=t,this.zoom=Math.max(this.zoom,t));},Wi.maxZoom.get=function(){return this._maxZoom},Wi.maxZoom.set=function(t){this._maxZoom!==t&&(this._maxZoom=t,this.zoom=Math.min(this.zoom,t));},Wi.renderWorldCopies.get=function(){return this._renderWorldCopies},Wi.renderWorldCopies.set=function(t){void 0===t?t=!0:null===t&&(t=!1),this._renderWorldCopies=t;},Wi.worldSize.get=function(){return this.tileSize*this.scale},Wi.centerPoint.get=function(){return this.size._div(2)},Wi.size.get=function(){return new t.Point(this.width,this.height)},Wi.bearing.get=function(){return -this.angle/Math.PI*180},Wi.bearing.set=function(e){var i=-t.wrap(e,-180,180)*Math.PI/180;this.angle!==i&&(this._unmodified=!1,this.angle=i,this._calcMatrices(),this.rotationMatrix=t.create$4(),t.rotate(this.rotationMatrix,this.rotationMatrix,this.angle));},Wi.pitch.get=function(){return this._pitch/Math.PI*180},Wi.pitch.set=function(e){var i=t.clamp(e,0,60)/180*Math.PI;this._pitch!==i&&(this._unmodified=!1,this._pitch=i,this._calcMatrices());},Wi.fov.get=function(){return this._fov/Math.PI*180},Wi.fov.set=function(t){t=Math.max(.01,Math.min(60,t)),this._fov!==t&&(this._unmodified=!1,this._fov=t/180*Math.PI,this._calcMatrices());},Wi.zoom.get=function(){return this._zoom},Wi.zoom.set=function(t){var e=Math.min(Math.max(t,this.minZoom),this.maxZoom);this._zoom!==e&&(this._unmodified=!1,this._zoom=e,this.scale=this.zoomScale(e),this.tileZoom=Math.floor(e),this.zoomFraction=e-this.tileZoom,this._constrain(),this._calcMatrices());},Wi.center.get=function(){return this._center},Wi.center.set=function(t){t.lat===this._center.lat&&t.lng===this._center.lng||(this._unmodified=!1,this._center=t,this._constrain(),this._calcMatrices());},Gi.prototype.coveringZoomLevel=function(t){return (t.roundZoom?Math.round:Math.floor)(this.zoom+this.scaleZoom(this.tileSize/t.tileSize))},Gi.prototype.getVisibleUnwrappedCoordinates=function(e){var i=[new t.UnwrappedTileID(0,e)];if(this._renderWorldCopies)for(var n=this.pointCoordinate(new t.Point(0,0),0),o=this.pointCoordinate(new t.Point(this.width,0),0),r=this.pointCoordinate(new t.Point(this.width,this.height),0),a=this.pointCoordinate(new t.Point(0,this.height),0),s=Math.floor(Math.min(n.column,o.column,r.column,a.column)),l=Math.floor(Math.max(n.column,o.column,r.column,a.column)),c=s-1;c<=l+1;c++)0!==c&&i.push(new t.UnwrappedTileID(c,e));return i},Gi.prototype.coveringTiles=function(e){var i=this.coveringZoomLevel(e),n=i;if(void 0!==e.minzoom&&i<e.minzoom)return [];void 0!==e.maxzoom&&i>e.maxzoom&&(i=e.maxzoom);var o=this.pointCoordinate(this.centerPoint,i),r=new t.Point(o.column-.5,o.row-.5);return function(e,i,n,o){void 0===o&&(o=!0);var r=1<<e,a={};function s(i,s,l){var c,h,u,p;if(l>=0&&l<=r)for(c=i;c<s;c++)h=Math.floor(c/r),u=(c%r+r)%r,0!==h&&!0!==o||(p=new t.OverscaledTileID(n,h,e,u,l),a[p.key]=p);}return ji(i[0],i[1],i[2],0,r,s),ji(i[2],i[3],i[0],0,r,s),Object.keys(a).map(function(t){return a[t]})}(i,[this.pointCoordinate(new t.Point(0,0),i),this.pointCoordinate(new t.Point(this.width,0),i),this.pointCoordinate(new t.Point(this.width,this.height),i),this.pointCoordinate(new t.Point(0,this.height),i)],e.reparseOverscaled?n:i,this._renderWorldCopies).sort(function(t,e){return r.dist(t.canonical)-r.dist(e.canonical)})},Gi.prototype.resize=function(t,e){this.width=t,this.height=e,this.pixelsToGLUnits=[2/t,-2/e],this._constrain(),this._calcMatrices();},Wi.unmodified.get=function(){return this._unmodified},Gi.prototype.zoomScale=function(t){return Math.pow(2,t)},Gi.prototype.scaleZoom=function(t){return Math.log(t)/Math.LN2},Gi.prototype.project=function(e){return new t.Point(this.lngX(e.lng),this.latY(e.lat))},Gi.prototype.unproject=function(t){return new U(this.xLng(t.x),this.yLat(t.y))},Wi.x.get=function(){return this.lngX(this.center.lng)},Wi.y.get=function(){return this.latY(this.center.lat)},Wi.point.get=function(){return new t.Point(this.x,this.y)},Gi.prototype.lngX=function(t){return (180+t)*this.worldSize/360},Gi.prototype.latY=function(e){return e=t.clamp(e,-this.maxValidLatitude,this.maxValidLatitude),(180-180/Math.PI*Math.log(Math.tan(Math.PI/4+e*Math.PI/360)))*this.worldSize/360},Gi.prototype.xLng=function(t){return 360*t/this.worldSize-180},Gi.prototype.yLat=function(t){var e=180-360*t/this.worldSize;return 360/Math.PI*Math.atan(Math.exp(e*Math.PI/180))-90},Gi.prototype.setLocationAtPoint=function(t,e){var i=this.pointCoordinate(e)._sub(this.pointCoordinate(this.centerPoint));this.center=this.coordinateLocation(this.locationCoordinate(t)._sub(i)),this._renderWorldCopies&&(this.center=this.center.wrap());},Gi.prototype.locationPoint=function(t){return this.coordinatePoint(this.locationCoordinate(t))},Gi.prototype.pointLocation=function(t){return this.coordinateLocation(this.pointCoordinate(t))},Gi.prototype.locationCoordinate=function(e){return new t.Coordinate(this.lngX(e.lng)/this.tileSize,this.latY(e.lat)/this.tileSize,this.zoom).zoomTo(this.tileZoom)},Gi.prototype.coordinateLocation=function(t){var e=t.zoomTo(this.zoom);return new U(this.xLng(e.column*this.tileSize),this.yLat(e.row*this.tileSize))},Gi.prototype.pointCoordinate=function(e,i){void 0===i&&(i=this.tileZoom);var n=[e.x,e.y,0,1],o=[e.x,e.y,1,1];t.transformMat4(n,n,this.pixelMatrixInverse),t.transformMat4(o,o,this.pixelMatrixInverse);var r=n[3],a=o[3],s=n[0]/r,l=o[0]/a,c=n[1]/r,h=o[1]/a,u=n[2]/r,p=o[2]/a,d=u===p?0:(0-u)/(p-u);return new t.Coordinate(t.number(s,l,d)/this.tileSize,t.number(c,h,d)/this.tileSize,this.zoom)._zoomTo(i)},Gi.prototype.coordinatePoint=function(e){var i=e.zoomTo(this.zoom),n=[i.column*this.tileSize,i.row*this.tileSize,0,1];return t.transformMat4(n,n,this.pixelMatrix),new t.Point(n[0]/n[3],n[1]/n[3])},Gi.prototype.getBounds=function(){return (new N).extend(this.pointLocation(new t.Point(0,0))).extend(this.pointLocation(new t.Point(this.width,0))).extend(this.pointLocation(new t.Point(this.width,this.height))).extend(this.pointLocation(new t.Point(0,this.height)))},Gi.prototype.getMaxBounds=function(){return this.latRange&&2===this.latRange.length&&this.lngRange&&2===this.lngRange.length?new N([this.lngRange[0],this.latRange[0]],[this.lngRange[1],this.latRange[1]]):null},Gi.prototype.setMaxBounds=function(t){t?(this.lngRange=[t.getWest(),t.getEast()],this.latRange=[t.getSouth(),t.getNorth()],this._constrain()):(this.lngRange=null,this.latRange=[-this.maxValidLatitude,this.maxValidLatitude]);},Gi.prototype.calculatePosMatrix=function(e,i){void 0===i&&(i=!1);var n=e.key,o=i?this._alignedPosMatrixCache:this._posMatrixCache;if(o[n])return o[n];var r=e.canonical,a=this.worldSize/this.zoomScale(r.z),s=r.x+Math.pow(2,r.z)*e.wrap,l=t.identity(new Float64Array(16));return t.translate(l,l,[s*a,r.y*a,0]),t.scale(l,l,[a/t.EXTENT,a/t.EXTENT,1]),t.multiply(l,i?this.alignedProjMatrix:this.projMatrix,l),o[n]=new Float32Array(l),o[n]},Gi.prototype._constrain=function(){if(this.center&&this.width&&this.height&&!this._constraining){this._constraining=!0;var e,i,n,o,r=-90,a=90,s=-180,l=180,c=this.size,h=this._unmodified;if(this.latRange){var u=this.latRange;r=this.latY(u[1]),e=(a=this.latY(u[0]))-r<c.y?c.y/(a-r):0;}if(this.lngRange){var p=this.lngRange;s=this.lngX(p[0]),i=(l=this.lngX(p[1]))-s<c.x?c.x/(l-s):0;}var d=Math.max(i||0,e||0);if(d)return this.center=this.unproject(new t.Point(i?(l+s)/2:this.x,e?(a+r)/2:this.y)),this.zoom+=this.scaleZoom(d),this._unmodified=h,void(this._constraining=!1);if(this.latRange){var _=this.y,f=c.y/2;_-f<r&&(o=r+f),_+f>a&&(o=a-f);}if(this.lngRange){var m=this.x,g=c.x/2;m-g<s&&(n=s+g),m+g>l&&(n=l-g);}void 0===n&&void 0===o||(this.center=this.unproject(new t.Point(void 0!==n?n:this.x,void 0!==o?o:this.y))),this._unmodified=h,this._constraining=!1;}},Gi.prototype._calcMatrices=function(){if(this.height){this.cameraToCenterDistance=.5/Math.tan(this._fov/2)*this.height;var e=this._fov/2,i=Math.PI/2+this._pitch,n=Math.sin(e)*this.cameraToCenterDistance/Math.sin(Math.PI-i-e),o=this.x,r=this.y,a=1.01*(Math.cos(Math.PI/2-this._pitch)*n+this.cameraToCenterDistance),s=new Float64Array(16);t.perspective(s,this._fov,this.width/this.height,1,a),t.scale(s,s,[1,-1,1]),t.translate(s,s,[0,0,-this.cameraToCenterDistance]),t.rotateX(s,s,this._pitch),t.rotateZ(s,s,this.angle),t.translate(s,s,[-o,-r,0]);var l=this.worldSize/(2*Math.PI*6378137*Math.abs(Math.cos(this.center.lat*(Math.PI/180))));t.scale(s,s,[1,1,l,1]),this.projMatrix=s;var c=this.width%2/2,h=this.height%2/2,u=Math.cos(this.angle),p=Math.sin(this.angle),d=o-Math.round(o)+u*c+p*h,_=r-Math.round(r)+u*h+p*c,f=new Float64Array(s);if(t.translate(f,f,[d>.5?d-1:d,_>.5?_-1:_,0]),this.alignedProjMatrix=f,s=t.create(),t.scale(s,s,[this.width/2,-this.height/2,1]),t.translate(s,s,[1,-1,0]),this.pixelMatrix=t.multiply(new Float64Array(16),s,this.projMatrix),!(s=t.invert(new Float64Array(16),this.pixelMatrix)))throw new Error("failed to invert matrix");this.pixelMatrixInverse=s,this._posMatrixCache={},this._alignedPosMatrixCache={};}},Gi.prototype.maxPitchScaleFactor=function(){if(!this.pixelMatrixInverse)return 1;var e=this.pointCoordinate(new t.Point(0,0)).zoomTo(this.zoom),i=[e.column*this.tileSize,e.row*this.tileSize,0,1];return t.transformMat4(i,i,this.pixelMatrix)[3]/this.cameraToCenterDistance},Object.defineProperties(Gi.prototype,Wi);var Xi=function(){var e,i,n,o,r;t.bindAll(["_onHashChange","_updateHash"],this),this._updateHash=(e=this._updateHashUnthrottled.bind(this),i=300,n=!1,o=0,r=function(){o=0,n&&(e(),o=setTimeout(r,i),n=!1);},function(){return n=!0,o||r(),o});};Xi.prototype.addTo=function(e){return this._map=e,t.window.addEventListener("hashchange",this._onHashChange,!1),this._map.on("moveend",this._updateHash),this},Xi.prototype.remove=function(){return t.window.removeEventListener("hashchange",this._onHashChange,!1),this._map.off("moveend",this._updateHash),clearTimeout(this._updateHash()),delete this._map,this},Xi.prototype.getHashString=function(t){var e=this._map.getCenter(),i=Math.round(100*this._map.getZoom())/100,n=Math.ceil((i*Math.LN2+Math.log(512/360/.5))/Math.LN10),o=Math.pow(10,n),r=Math.round(e.lng*o)/o,a=Math.round(e.lat*o)/o,s=this._map.getBearing(),l=this._map.getPitch(),c="";return c+=t?"#/"+r+"/"+a+"/"+i:"#"+i+"/"+a+"/"+r,(s||l)&&(c+="/"+Math.round(10*s)/10),l&&(c+="/"+Math.round(l)),c},Xi.prototype._onHashChange=function(){var e=t.window.location.hash.replace("#","").split("/");return e.length>=3&&(this._map.jumpTo({center:[+e[2],+e[1]],zoom:+e[0],bearing:+(e[3]||0),pitch:+(e[4]||0)}),!0)},Xi.prototype._updateHashUnthrottled=function(){var e=this.getHashString();t.window.history.replaceState(t.window.history.state,"",e);};var Hi=function(e){function n(n,o,r,a){void 0===a&&(a={});var s=i.mousePos(o.getCanvasContainer(),r),l=o.unproject(s);e.call(this,n,t.extend({point:s,lngLat:l,originalEvent:r},a)),this._defaultPrevented=!1,this.target=o;}e&&(n.__proto__=e),n.prototype=Object.create(e&&e.prototype),n.prototype.constructor=n;var o={defaultPrevented:{configurable:!0}};return n.prototype.preventDefault=function(){this._defaultPrevented=!0;},o.defaultPrevented.get=function(){return this._defaultPrevented},Object.defineProperties(n.prototype,o),n}(t.Event),Ki=function(e){function n(n,o,r){var a=i.touchPos(o.getCanvasContainer(),r),s=a.map(function(t){return o.unproject(t)}),l=a.reduce(function(t,e,i,n){return t.add(e.div(n.length))},new t.Point(0,0)),c=o.unproject(l);e.call(this,n,{points:a,point:l,lngLats:s,lngLat:c,originalEvent:r}),this._defaultPrevented=!1;}e&&(n.__proto__=e),n.prototype=Object.create(e&&e.prototype),n.prototype.constructor=n;var o={defaultPrevented:{configurable:!0}};return n.prototype.preventDefault=function(){this._defaultPrevented=!0;},o.defaultPrevented.get=function(){return this._defaultPrevented},Object.defineProperties(n.prototype,o),n}(t.Event),Yi=function(t){function e(e,i,n){t.call(this,e,{originalEvent:n}),this._defaultPrevented=!1;}t&&(e.__proto__=t),e.prototype=Object.create(t&&t.prototype),e.prototype.constructor=e;var i={defaultPrevented:{configurable:!0}};return e.prototype.preventDefault=function(){this._defaultPrevented=!0;},i.defaultPrevented.get=function(){return this._defaultPrevented},Object.defineProperties(e.prototype,i),e}(t.Event),Ji=function(e){this._map=e,this._el=e.getCanvasContainer(),this._delta=0,t.bindAll(["_onWheel","_onTimeout","_onScrollFrame","_onScrollFinished"],this);};Ji.prototype.isEnabled=function(){return !!this._enabled},Ji.prototype.isActive=function(){return !!this._active},Ji.prototype.enable=function(t){this.isEnabled()||(this._enabled=!0,this._aroundCenter=t&&"center"===t.around);},Ji.prototype.disable=function(){this.isEnabled()&&(this._enabled=!1);},Ji.prototype.onWheel=function(e){if(this.isEnabled()){var i=e.deltaMode===t.window.WheelEvent.DOM_DELTA_LINE?40*e.deltaY:e.deltaY,n=t.browser.now(),o=n-(this._lastWheelEventTime||0);this._lastWheelEventTime=n,0!==i&&i%4.000244140625==0?this._type="wheel":0!==i&&Math.abs(i)<4?this._type="trackpad":o>400?(this._type=null,this._lastValue=i,this._timeout=setTimeout(this._onTimeout,40,e)):this._type||(this._type=Math.abs(o*i)<200?"trackpad":"wheel",this._timeout&&(clearTimeout(this._timeout),this._timeout=null,i+=this._lastValue)),e.shiftKey&&i&&(i/=4),this._type&&(this._lastWheelEvent=e,this._delta-=i,this.isActive()||this._start(e)),e.preventDefault();}},Ji.prototype._onTimeout=function(t){this._type="wheel",this._delta-=this._lastValue,this.isActive()||this._start(t);},Ji.prototype._start=function(e){if(this._delta){this._frameId&&(this._map._cancelRenderFrame(this._frameId),this._frameId=null),this._active=!0,this._map.fire(new t.Event("movestart",{originalEvent:e})),this._map.fire(new t.Event("zoomstart",{originalEvent:e})),this._finishTimeout&&clearTimeout(this._finishTimeout);var n=i.mousePos(this._el,e);this._around=U.convert(this._aroundCenter?this._map.getCenter():this._map.unproject(n)),this._aroundPoint=this._map.transform.locationPoint(this._around),this._frameId||(this._frameId=this._map._requestRenderFrame(this._onScrollFrame));}},Ji.prototype._onScrollFrame=function(){var e=this;if(this._frameId=null,this.isActive()){var i=this._map.transform;if(0!==this._delta){var n="wheel"===this._type&&Math.abs(this._delta)>4.000244140625?1/450:.01,o=2/(1+Math.exp(-Math.abs(this._delta*n)));this._delta<0&&0!==o&&(o=1/o);var r="number"==typeof this._targetZoom?i.zoomScale(this._targetZoom):i.scale;this._targetZoom=Math.min(i.maxZoom,Math.max(i.minZoom,i.scaleZoom(r*o))),"wheel"===this._type&&(this._startZoom=i.zoom,this._easing=this._smoothOutEasing(200)),this._delta=0;}var a="number"==typeof this._targetZoom?this._targetZoom:i.zoom,s=this._startZoom,l=this._easing,c=!1;if("wheel"===this._type&&s&&l){var h=Math.min((t.browser.now()-this._lastWheelEventTime)/200,1),u=l(h);i.zoom=t.number(s,a,u),h<1?this._frameId||(this._frameId=this._map._requestRenderFrame(this._onScrollFrame)):c=!0;}else i.zoom=a,c=!0;i.setLocationAtPoint(this._around,this._aroundPoint),this._map.fire(new t.Event("move",{originalEvent:this._lastWheelEvent})),this._map.fire(new t.Event("zoom",{originalEvent:this._lastWheelEvent})),c&&(this._active=!1,this._finishTimeout=setTimeout(function(){e._map.fire(new t.Event("zoomend",{originalEvent:e._lastWheelEvent})),e._map.fire(new t.Event("moveend",{originalEvent:e._lastWheelEvent})),delete e._targetZoom;},200));}},Ji.prototype._smoothOutEasing=function(e){var i=t.ease;if(this._prevEase){var n=this._prevEase,o=(t.browser.now()-n.start)/n.duration,r=n.easing(o+.01)-n.easing(o),a=.27/Math.sqrt(r*r+1e-4)*.01,s=Math.sqrt(.0729-a*a);i=t.bezier(a,s,.25,1);}return this._prevEase={start:t.browser.now(),duration:e,easing:i},i};var Qi=function(e,i){this._map=e,this._el=e.getCanvasContainer(),this._container=e.getContainer(),this._clickTolerance=i.clickTolerance||1,t.bindAll(["_onMouseMove","_onMouseUp","_onKeyDown"],this);};Qi.prototype.isEnabled=function(){return !!this._enabled},Qi.prototype.isActive=function(){return !!this._active},Qi.prototype.enable=function(){this.isEnabled()||(this._enabled=!0);},Qi.prototype.disable=function(){this.isEnabled()&&(this._enabled=!1);},Qi.prototype.onMouseDown=function(e){this.isEnabled()&&e.shiftKey&&0===e.button&&(t.window.document.addEventListener("mousemove",this._onMouseMove,!1),t.window.document.addEventListener("keydown",this._onKeyDown,!1),t.window.document.addEventListener("mouseup",this._onMouseUp,!1),i.disableDrag(),this._startPos=this._lastPos=i.mousePos(this._el,e),this._active=!0);},Qi.prototype._onMouseMove=function(t){var e=i.mousePos(this._el,t);if(!(this._lastPos.equals(e)||!this._box&&e.dist(this._startPos)<this._clickTolerance)){var n=this._startPos;this._lastPos=e,this._box||(this._box=i.create("div","mapboxgl-boxzoom",this._container),this._container.classList.add("mapboxgl-crosshair"),this._fireEvent("boxzoomstart",t));var o=Math.min(n.x,e.x),r=Math.max(n.x,e.x),a=Math.min(n.y,e.y),s=Math.max(n.y,e.y);i.setTransform(this._box,"translate("+o+"px,"+a+"px)"),this._box.style.width=r-o+"px",this._box.style.height=s-a+"px";}},Qi.prototype._onMouseUp=function(e){if(0===e.button){var n=this._startPos,o=i.mousePos(this._el,e);this._finish(),i.suppressClick(),n.x===o.x&&n.y===o.y?this._fireEvent("boxzoomcancel",e):this._map.fitScreenCoordinates(n,o,this._map.getBearing(),{linear:!0}).fire(new t.Event("boxzoomend",{originalEvent:e}));}},Qi.prototype._onKeyDown=function(t){27===t.keyCode&&(this._finish(),this._fireEvent("boxzoomcancel",t));},Qi.prototype._finish=function(){this._active=!1,t.window.document.removeEventListener("mousemove",this._onMouseMove,!1),t.window.document.removeEventListener("keydown",this._onKeyDown,!1),t.window.document.removeEventListener("mouseup",this._onMouseUp,!1),this._container.classList.remove("mapboxgl-crosshair"),this._box&&(i.remove(this._box),this._box=null),i.enableDrag(),delete this._startPos,delete this._lastPos;},Qi.prototype._fireEvent=function(e,i){return this._map.fire(new t.Event(e,{originalEvent:i}))};var $i=t.bezier(0,0,.25,1),tn=function(e,i){this._map=e,this._el=i.element||e.getCanvasContainer(),this._state="disabled",this._button=i.button||"right",this._bearingSnap=i.bearingSnap||0,this._pitchWithRotate=!1!==i.pitchWithRotate,t.bindAll(["onMouseDown","_onMouseMove","_onMouseUp","_onBlur","_onDragFrame"],this);};tn.prototype.isEnabled=function(){return "disabled"!==this._state},tn.prototype.isActive=function(){return "active"===this._state},tn.prototype.enable=function(){this.isEnabled()||(this._state="enabled");},tn.prototype.disable=function(){if(this.isEnabled())switch(this._state){case"active":this._state="disabled",this._unbind(),this._deactivate(),this._fireEvent("rotateend"),this._pitchWithRotate&&this._fireEvent("pitchend"),this._fireEvent("moveend");break;case"pending":this._state="disabled",this._unbind();break;default:this._state="disabled";}},tn.prototype.onMouseDown=function(e){if("enabled"===this._state){if("right"===this._button){if(this._eventButton=i.mouseButton(e),this._eventButton!==(e.ctrlKey?0:2))return}else{if(e.ctrlKey||0!==i.mouseButton(e))return;this._eventButton=0;}i.disableDrag(),t.window.document.addEventListener("mousemove",this._onMouseMove,{capture:!0}),t.window.document.addEventListener("mouseup",this._onMouseUp),t.window.addEventListener("blur",this._onBlur),this._state="pending",this._inertia=[[t.browser.now(),this._map.getBearing()]],this._startPos=this._lastPos=i.mousePos(this._el,e),this._center=this._map.transform.centerPoint,e.preventDefault();}},tn.prototype._onMouseMove=function(t){var e=i.mousePos(this._el,t);this._lastPos.equals(e)||(this._lastMoveEvent=t,this._lastPos=e,"pending"===this._state&&(this._state="active",this._fireEvent("rotatestart",t),this._fireEvent("movestart",t),this._pitchWithRotate&&this._fireEvent("pitchstart",t)),this._frameId||(this._frameId=this._map._requestRenderFrame(this._onDragFrame)));},tn.prototype._onDragFrame=function(){this._frameId=null;var e=this._lastMoveEvent;if(e){var i=this._map.transform,n=this._startPos,o=this._lastPos,r=.8*(n.x-o.x),a=-.5*(n.y-o.y),s=i.bearing-r,l=i.pitch-a,c=this._inertia,h=c[c.length-1];this._drainInertiaBuffer(),c.push([t.browser.now(),this._map._normalizeBearing(s,h[1])]),i.bearing=s,this._pitchWithRotate&&(this._fireEvent("pitch",e),i.pitch=l),this._fireEvent("rotate",e),this._fireEvent("move",e),delete this._lastMoveEvent,this._startPos=this._lastPos;}},tn.prototype._onMouseUp=function(t){if(i.mouseButton(t)===this._eventButton)switch(this._state){case"active":this._state="enabled",i.suppressClick(),this._unbind(),this._deactivate(),this._inertialRotate(t);break;case"pending":this._state="enabled",this._unbind();}},tn.prototype._onBlur=function(t){switch(this._state){case"active":this._state="enabled",this._unbind(),this._deactivate(),this._fireEvent("rotateend",t),this._pitchWithRotate&&this._fireEvent("pitchend",t),this._fireEvent("moveend",t);break;case"pending":this._state="enabled",this._unbind();}},tn.prototype._unbind=function(){t.window.document.removeEventListener("mousemove",this._onMouseMove,{capture:!0}),t.window.document.removeEventListener("mouseup",this._onMouseUp),t.window.removeEventListener("blur",this._onBlur),i.enableDrag();},tn.prototype._deactivate=function(){this._frameId&&(this._map._cancelRenderFrame(this._frameId),this._frameId=null),delete this._lastMoveEvent,delete this._startPos,delete this._lastPos;},tn.prototype._inertialRotate=function(t){var e=this;this._fireEvent("rotateend",t),this._drainInertiaBuffer();var i=this._map,n=i.getBearing(),o=this._inertia,r=function(){Math.abs(n)<e._bearingSnap?i.resetNorth({noMoveStart:!0},{originalEvent:t}):e._fireEvent("moveend",t),e._pitchWithRotate&&e._fireEvent("pitchend",t);};if(o.length<2)r();else{var a=o[0],s=o[o.length-1],l=o[o.length-2],c=i._normalizeBearing(n,l[1]),h=s[1]-a[1],u=h<0?-1:1,p=(s[0]-a[0])/1e3;if(0!==h&&0!==p){var d=Math.abs(h*(.25/p));d>180&&(d=180);var _=d/180;c+=u*d*(_/2),Math.abs(i._normalizeBearing(c,0))<this._bearingSnap&&(c=i._normalizeBearing(0,c)),i.rotateTo(c,{duration:1e3*_,easing:$i,noMoveStart:!0},{originalEvent:t});}else r();}},tn.prototype._fireEvent=function(e,i){return this._map.fire(new t.Event(e,i?{originalEvent:i}:{}))},tn.prototype._drainInertiaBuffer=function(){for(var e=this._inertia,i=t.browser.now();e.length>0&&i-e[0][0]>160;)e.shift();};var en=t.bezier(0,0,.3,1),nn=function(e,i){this._map=e,this._el=e.getCanvasContainer(),this._state="disabled",this._clickTolerance=i.clickTolerance||1,t.bindAll(["_onMove","_onMouseUp","_onTouchEnd","_onBlur","_onDragFrame"],this);};nn.prototype.isEnabled=function(){return "disabled"!==this._state},nn.prototype.isActive=function(){return "active"===this._state},nn.prototype.enable=function(){this.isEnabled()||(this._el.classList.add("mapboxgl-touch-drag-pan"),this._state="enabled");},nn.prototype.disable=function(){if(this.isEnabled())switch(this._el.classList.remove("mapboxgl-touch-drag-pan"),this._state){case"active":this._state="disabled",this._unbind(),this._deactivate(),this._fireEvent("dragend"),this._fireEvent("moveend");break;case"pending":this._state="disabled",this._unbind();break;default:this._state="disabled";}},nn.prototype.onMouseDown=function(e){"enabled"===this._state&&(e.ctrlKey||0!==i.mouseButton(e)||(i.addEventListener(t.window.document,"mousemove",this._onMove,{capture:!0}),i.addEventListener(t.window.document,"mouseup",this._onMouseUp),this._start(e)));},nn.prototype.onTouchStart=function(e){"enabled"===this._state&&(e.touches.length>1||(i.addEventListener(t.window.document,"touchmove",this._onMove,{capture:!0,passive:!1}),i.addEventListener(t.window.document,"touchend",this._onTouchEnd),this._start(e)));},nn.prototype._start=function(e){t.window.addEventListener("blur",this._onBlur),this._state="pending",this._startPos=this._mouseDownPos=this._lastPos=i.mousePos(this._el,e),this._inertia=[[t.browser.now(),this._startPos]];},nn.prototype._onMove=function(e){e.preventDefault();var n=i.mousePos(this._el,e);this._lastPos.equals(n)||"pending"===this._state&&n.dist(this._mouseDownPos)<this._clickTolerance||(this._lastMoveEvent=e,this._lastPos=n,this._drainInertiaBuffer(),this._inertia.push([t.browser.now(),this._lastPos]),"pending"===this._state&&(this._state="active",this._fireEvent("dragstart",e),this._fireEvent("movestart",e)),this._frameId||(this._frameId=this._map._requestRenderFrame(this._onDragFrame)));},nn.prototype._onDragFrame=function(){this._frameId=null;var t=this._lastMoveEvent;if(t){var e=this._map.transform;e.setLocationAtPoint(e.pointLocation(this._startPos),this._lastPos),this._fireEvent("drag",t),this._fireEvent("move",t),this._startPos=this._lastPos,delete this._lastMoveEvent;}},nn.prototype._onMouseUp=function(t){if(0===i.mouseButton(t))switch(this._state){case"active":this._state="enabled",i.suppressClick(),this._unbind(),this._deactivate(),this._inertialPan(t);break;case"pending":this._state="enabled",this._unbind();}},nn.prototype._onTouchEnd=function(t){switch(this._state){case"active":this._state="enabled",this._unbind(),this._deactivate(),this._inertialPan(t);break;case"pending":this._state="enabled",this._unbind();}},nn.prototype._onBlur=function(t){switch(this._state){case"active":this._state="enabled",this._unbind(),this._deactivate(),this._fireEvent("dragend",t),this._fireEvent("moveend",t);break;case"pending":this._state="enabled",this._unbind();}},nn.prototype._unbind=function(){i.removeEventListener(t.window.document,"touchmove",this._onMove,{capture:!0,passive:!1}),i.removeEventListener(t.window.document,"touchend",this._onTouchEnd),i.removeEventListener(t.window.document,"mousemove",this._onMove,{capture:!0}),i.removeEventListener(t.window.document,"mouseup",this._onMouseUp),i.removeEventListener(t.window,"blur",this._onBlur);},nn.prototype._deactivate=function(){this._frameId&&(this._map._cancelRenderFrame(this._frameId),this._frameId=null),delete this._lastMoveEvent,delete this._startPos,delete this._mouseDownPos,delete this._lastPos;},nn.prototype._inertialPan=function(t){this._fireEvent("dragend",t),this._drainInertiaBuffer();var e=this._inertia;if(e.length<2)this._fireEvent("moveend",t);else{var i=e[e.length-1],n=e[0],o=i[1].sub(n[1]),r=(i[0]-n[0])/1e3;if(0===r||i[1].equals(n[1]))this._fireEvent("moveend",t);else{var a=o.mult(.3/r),s=a.mag();s>1400&&(s=1400,a._unit()._mult(s));var l=s/750,c=a.mult(-l/2);this._map.panBy(c,{duration:1e3*l,easing:en,noMoveStart:!0},{originalEvent:t});}}},nn.prototype._fireEvent=function(e,i){return this._map.fire(new t.Event(e,i?{originalEvent:i}:{}))},nn.prototype._drainInertiaBuffer=function(){for(var e=this._inertia,i=t.browser.now();e.length>0&&i-e[0][0]>160;)e.shift();};var on=function(e){this._map=e,this._el=e.getCanvasContainer(),t.bindAll(["_onKeyDown"],this);};function rn(t){return t*(2-t)}on.prototype.isEnabled=function(){return !!this._enabled},on.prototype.enable=function(){this.isEnabled()||(this._el.addEventListener("keydown",this._onKeyDown,!1),this._enabled=!0);},on.prototype.disable=function(){this.isEnabled()&&(this._el.removeEventListener("keydown",this._onKeyDown),this._enabled=!1);},on.prototype._onKeyDown=function(t){if(!(t.altKey||t.ctrlKey||t.metaKey)){var e=0,i=0,n=0,o=0,r=0;switch(t.keyCode){case 61:case 107:case 171:case 187:e=1;break;case 189:case 109:case 173:e=-1;break;case 37:t.shiftKey?i=-1:(t.preventDefault(),o=-1);break;case 39:t.shiftKey?i=1:(t.preventDefault(),o=1);break;case 38:t.shiftKey?n=1:(t.preventDefault(),r=-1);break;case 40:t.shiftKey?n=-1:(r=1,t.preventDefault());break;default:return}var a=this._map,s=a.getZoom(),l={duration:300,delayEndEvents:500,easing:rn,zoom:e?Math.round(s)+e*(t.shiftKey?2:1):s,bearing:a.getBearing()+15*i,pitch:a.getPitch()+10*n,offset:[100*-o,100*-r],center:a.getCenter()};a.easeTo(l,{originalEvent:t});}};var an=function(e){this._map=e,t.bindAll(["_onDblClick","_onZoomEnd"],this);};an.prototype.isEnabled=function(){return !!this._enabled},an.prototype.isActive=function(){return !!this._active},an.prototype.enable=function(){this.isEnabled()||(this._enabled=!0);},an.prototype.disable=function(){this.isEnabled()&&(this._enabled=!1);},an.prototype.onTouchStart=function(t){var e=this;this.isEnabled()&&(t.points.length>1||(this._tapped?(clearTimeout(this._tapped),this._tapped=null,this._zoom(t)):this._tapped=setTimeout(function(){e._tapped=null;},300)));},an.prototype.onDblClick=function(t){this.isEnabled()&&(t.originalEvent.preventDefault(),this._zoom(t));},an.prototype._zoom=function(t){this._active=!0,this._map.on("zoomend",this._onZoomEnd),this._map.zoomTo(this._map.getZoom()+(t.originalEvent.shiftKey?-1:1),{around:t.lngLat},t);},an.prototype._onZoomEnd=function(){this._active=!1,this._map.off("zoomend",this._onZoomEnd);};var sn=t.bezier(0,0,.15,1),ln=function(e){this._map=e,this._el=e.getCanvasContainer(),t.bindAll(["_onMove","_onEnd","_onTouchFrame"],this);};ln.prototype.isEnabled=function(){return !!this._enabled},ln.prototype.enable=function(t){this.isEnabled()||(this._el.classList.add("mapboxgl-touch-zoom-rotate"),this._enabled=!0,this._aroundCenter=!!t&&"center"===t.around);},ln.prototype.disable=function(){this.isEnabled()&&(this._el.classList.remove("mapboxgl-touch-zoom-rotate"),this._enabled=!1);},ln.prototype.disableRotation=function(){this._rotationDisabled=!0;},ln.prototype.enableRotation=function(){this._rotationDisabled=!1;},ln.prototype.onStart=function(e){if(this.isEnabled()&&2===e.touches.length){var n=i.mousePos(this._el,e.touches[0]),o=i.mousePos(this._el,e.touches[1]),r=n.add(o).div(2);this._startVec=n.sub(o),this._startAround=this._map.transform.pointLocation(r),this._gestureIntent=void 0,this._inertia=[],i.addEventListener(t.window.document,"touchmove",this._onMove,{passive:!1}),i.addEventListener(t.window.document,"touchend",this._onEnd);}},ln.prototype._getTouchEventData=function(t){var e=i.mousePos(this._el,t.touches[0]),n=i.mousePos(this._el,t.touches[1]),o=e.sub(n);return {vec:o,center:e.add(n).div(2),scale:o.mag()/this._startVec.mag(),bearing:this._rotationDisabled?0:180*o.angleWith(this._startVec)/Math.PI}},ln.prototype._onMove=function(e){if(2===e.touches.length){var i=this._getTouchEventData(e),n=i.vec,o=i.scale,r=i.bearing;if(!this._gestureIntent){var a=Math.abs(1-o)>.15;Math.abs(r)>10?this._gestureIntent="rotate":a&&(this._gestureIntent="zoom"),this._gestureIntent&&(this._map.fire(new t.Event(this._gestureIntent+"start",{originalEvent:e})),this._map.fire(new t.Event("movestart",{originalEvent:e})),this._startVec=n);}this._lastTouchEvent=e,this._frameId||(this._frameId=this._map._requestRenderFrame(this._onTouchFrame)),e.preventDefault();}},ln.prototype._onTouchFrame=function(){this._frameId=null;var e=this._gestureIntent;if(e){var i=this._map.transform;this._startScale||(this._startScale=i.scale,this._startBearing=i.bearing);var n=this._getTouchEventData(this._lastTouchEvent),o=n.center,r=n.bearing,a=n.scale,s=i.pointLocation(o),l=i.locationPoint(s);"rotate"===e&&(i.bearing=this._startBearing+r),i.zoom=i.scaleZoom(this._startScale*a),i.setLocationAtPoint(this._startAround,l),this._map.fire(new t.Event(e,{originalEvent:this._lastTouchEvent})),this._map.fire(new t.Event("move",{originalEvent:this._lastTouchEvent})),this._drainInertiaBuffer(),this._inertia.push([t.browser.now(),a,o]);}},ln.prototype._onEnd=function(e){i.removeEventListener(t.window.document,"touchmove",this._onMove,{passive:!1}),i.removeEventListener(t.window.document,"touchend",this._onEnd);var n=this._gestureIntent,o=this._startScale;if(this._frameId&&(this._map._cancelRenderFrame(this._frameId),this._frameId=null),delete this._gestureIntent,delete this._startScale,delete this._startBearing,delete this._lastTouchEvent,n){this._map.fire(new t.Event(n+"end",{originalEvent:e})),this._drainInertiaBuffer();var r=this._inertia,a=this._map;if(r.length<2)a.snapToNorth({},{originalEvent:e});else{var s=r[r.length-1],l=r[0],c=a.transform.scaleZoom(o*s[1]),h=a.transform.scaleZoom(o*l[1]),u=c-h,p=(s[0]-l[0])/1e3,d=s[2];if(0!==p&&c!==h){var _=.15*u/p;Math.abs(_)>2.5&&(_=_>0?2.5:-2.5);var f=1e3*Math.abs(_/(12*.15)),m=c+_*f/2e3;m<0&&(m=0),a.easeTo({zoom:m,duration:f,easing:sn,around:this._aroundCenter?a.getCenter():a.unproject(d),noMoveStart:!0},{originalEvent:e});}else a.snapToNorth({},{originalEvent:e});}}},ln.prototype._drainInertiaBuffer=function(){for(var e=this._inertia,i=t.browser.now();e.length>2&&i-e[0][0]>160;)e.shift();};var cn={scrollZoom:Ji,boxZoom:Qi,dragRotate:tn,dragPan:nn,keyboard:on,doubleClickZoom:an,touchZoomRotate:ln};var hn=function(e){function i(i,n){e.call(this),this._moving=!1,this._zooming=!1,this.transform=i,this._bearingSnap=n.bearingSnap,t.bindAll(["_renderFrameCallback"],this);}return e&&(i.__proto__=e),i.prototype=Object.create(e&&e.prototype),i.prototype.constructor=i,i.prototype.getCenter=function(){return this.transform.center},i.prototype.setCenter=function(t,e){return this.jumpTo({center:t},e)},i.prototype.panBy=function(e,i,n){return e=t.Point.convert(e).mult(-1),this.panTo(this.transform.center,t.extend({offset:e},i),n)},i.prototype.panTo=function(e,i,n){return this.easeTo(t.extend({center:e},i),n)},i.prototype.getZoom=function(){return this.transform.zoom},i.prototype.setZoom=function(t,e){return this.jumpTo({zoom:t},e),this},i.prototype.zoomTo=function(e,i,n){return this.easeTo(t.extend({zoom:e},i),n)},i.prototype.zoomIn=function(t,e){return this.zoomTo(this.getZoom()+1,t,e),this},i.prototype.zoomOut=function(t,e){return this.zoomTo(this.getZoom()-1,t,e),this},i.prototype.getBearing=function(){return this.transform.bearing},i.prototype.setBearing=function(t,e){return this.jumpTo({bearing:t},e),this},i.prototype.rotateTo=function(e,i,n){return this.easeTo(t.extend({bearing:e},i),n)},i.prototype.resetNorth=function(e,i){return this.rotateTo(0,t.extend({duration:1e3},e),i),this},i.prototype.snapToNorth=function(t,e){return Math.abs(this.getBearing())<this._bearingSnap?this.resetNorth(t,e):this},i.prototype.getPitch=function(){return this.transform.pitch},i.prototype.setPitch=function(t,e){return this.jumpTo({pitch:t},e),this},i.prototype.cameraForBounds=function(t,e){return t=N.convert(t),this._cameraForBoxAndBearing(t.getNorthWest(),t.getSouthEast(),0,e)},i.prototype._cameraForBoxAndBearing=function(e,i,n,o){if("number"==typeof(o=t.extend({padding:{top:0,bottom:0,right:0,left:0},offset:[0,0],maxZoom:this.transform.maxZoom},o)).padding){var r=o.padding;o.padding={top:r,bottom:r,right:r,left:r};}if(t.deepEqual(Object.keys(o.padding).sort(function(t,e){return t<e?-1:t>e?1:0}),["bottom","left","right","top"])){var a=[(o.padding.left-o.padding.right)/2,(o.padding.top-o.padding.bottom)/2],s=Math.min(o.padding.right,o.padding.left),l=Math.min(o.padding.top,o.padding.bottom);o.offset=[o.offset[0]+a[0],o.offset[1]+a[1]];var c=this.transform,h=c.project(U.convert(e)),u=c.project(U.convert(i)),p=h.rotate(-n*Math.PI/180),d=u.rotate(-n*Math.PI/180),_=new t.Point(Math.max(p.x,d.x),Math.max(p.y,d.y)),f=new t.Point(Math.min(p.x,d.x),Math.min(p.y,d.y)),m=t.Point.convert(o.offset),g=_.sub(f),v=(c.width-2*s-2*Math.abs(m.x))/g.x,y=(c.height-2*l-2*Math.abs(m.y))/g.y;if(!(y<0||v<0))return o.center=c.unproject(h.add(u).div(2)),o.zoom=Math.min(c.scaleZoom(c.scale*Math.min(v,y)),o.maxZoom),o.bearing=n,o;t.warnOnce("Map cannot fit within canvas with the given bounds, padding, and/or offset.");}else t.warnOnce("options.padding must be a positive number, or an Object with keys 'bottom', 'left', 'right', 'top'");},i.prototype.fitBounds=function(t,e,i){return this._fitInternal(this.cameraForBounds(t,e),e,i)},i.prototype.fitScreenCoordinates=function(e,i,n,o,r){return this._fitInternal(this._cameraForBoxAndBearing(this.transform.pointLocation(t.Point.convert(e)),this.transform.pointLocation(t.Point.convert(i)),n,o),o,r)},i.prototype._fitInternal=function(e,i,n){return e?(i=t.extend(e,i)).linear?this.easeTo(i,n):this.flyTo(i,n):this},i.prototype.jumpTo=function(e,i){this.stop();var n=this.transform,o=!1,r=!1,a=!1;return "zoom"in e&&n.zoom!==+e.zoom&&(o=!0,n.zoom=+e.zoom),void 0!==e.center&&(n.center=U.convert(e.center)),"bearing"in e&&n.bearing!==+e.bearing&&(r=!0,n.bearing=+e.bearing),"pitch"in e&&n.pitch!==+e.pitch&&(a=!0,n.pitch=+e.pitch),this.fire(new t.Event("movestart",i)).fire(new t.Event("move",i)),o&&this.fire(new t.Event("zoomstart",i)).fire(new t.Event("zoom",i)).fire(new t.Event("zoomend",i)),r&&this.fire(new t.Event("rotatestart",i)).fire(new t.Event("rotate",i)).fire(new t.Event("rotateend",i)),a&&this.fire(new t.Event("pitchstart",i)).fire(new t.Event("pitch",i)).fire(new t.Event("pitchend",i)),this.fire(new t.Event("moveend",i))},i.prototype.easeTo=function(e,i){var n=this;this.stop(),!1===(e=t.extend({offset:[0,0],duration:500,easing:t.ease},e)).animate&&(e.duration=0);var o=this.transform,r=this.getZoom(),a=this.getBearing(),s=this.getPitch(),l="zoom"in e?+e.zoom:r,c="bearing"in e?this._normalizeBearing(e.bearing,a):a,h="pitch"in e?+e.pitch:s,u=o.centerPoint.add(t.Point.convert(e.offset)),p=o.pointLocation(u),d=U.convert(e.center||p);this._normalizeCenter(d);var _,f,m=o.project(p),g=o.project(d).sub(m),v=o.zoomScale(l-r);return e.around&&(_=U.convert(e.around),f=o.locationPoint(_)),this._zooming=l!==r,this._rotating=a!==c,this._pitching=h!==s,this._prepareEase(i,e.noMoveStart),clearTimeout(this._easeEndTimeoutID),this._ease(function(e){if(n._zooming&&(o.zoom=t.number(r,l,e)),n._rotating&&(o.bearing=t.number(a,c,e)),n._pitching&&(o.pitch=t.number(s,h,e)),_)o.setLocationAtPoint(_,f);else{var p=o.zoomScale(o.zoom-r),d=l>r?Math.min(2,v):Math.max(.5,v),y=Math.pow(d,1-e),x=o.unproject(m.add(g.mult(e*y)).mult(p));o.setLocationAtPoint(o.renderWorldCopies?x.wrap():x,u);}n._fireMoveEvents(i);},function(){e.delayEndEvents?n._easeEndTimeoutID=setTimeout(function(){return n._afterEase(i)},e.delayEndEvents):n._afterEase(i);},e),this},i.prototype._prepareEase=function(e,i){this._moving=!0,i||this.fire(new t.Event("movestart",e)),this._zooming&&this.fire(new t.Event("zoomstart",e)),this._rotating&&this.fire(new t.Event("rotatestart",e)),this._pitching&&this.fire(new t.Event("pitchstart",e));},i.prototype._fireMoveEvents=function(e){this.fire(new t.Event("move",e)),this._zooming&&this.fire(new t.Event("zoom",e)),this._rotating&&this.fire(new t.Event("rotate",e)),this._pitching&&this.fire(new t.Event("pitch",e));},i.prototype._afterEase=function(e){var i=this._zooming,n=this._rotating,o=this._pitching;this._moving=!1,this._zooming=!1,this._rotating=!1,this._pitching=!1,i&&this.fire(new t.Event("zoomend",e)),n&&this.fire(new t.Event("rotateend",e)),o&&this.fire(new t.Event("pitchend",e)),this.fire(new t.Event("moveend",e));},i.prototype.flyTo=function(e,i){var n=this;this.stop(),e=t.extend({offset:[0,0],speed:1.2,curve:1.42,easing:t.ease},e);var o=this.transform,r=this.getZoom(),a=this.getBearing(),s=this.getPitch(),l="zoom"in e?t.clamp(+e.zoom,o.minZoom,o.maxZoom):r,c="bearing"in e?this._normalizeBearing(e.bearing,a):a,h="pitch"in e?+e.pitch:s,u=o.zoomScale(l-r),p=o.centerPoint.add(t.Point.convert(e.offset)),d=o.pointLocation(p),_=U.convert(e.center||d);this._normalizeCenter(_);var f=o.project(d),m=o.project(_).sub(f),g=e.curve,v=Math.max(o.width,o.height),y=v/u,x=m.mag();if("minZoom"in e){var b=t.clamp(Math.min(e.minZoom,r,l),o.minZoom,o.maxZoom),w=v/o.zoomScale(b-r);g=Math.sqrt(w/x*2);}var E=g*g;function T(t){var e=(y*y-v*v+(t?-1:1)*E*E*x*x)/(2*(t?y:v)*E*x);return Math.log(Math.sqrt(e*e+1)-e)}function S(t){return (Math.exp(t)-Math.exp(-t))/2}function I(t){return (Math.exp(t)+Math.exp(-t))/2}var C=T(0),z=function(t){return I(C)/I(C+g*t)},P=function(t){return v*((I(C)*(S(e=C+g*t)/I(e))-S(C))/E)/x;var e;},R=(T(1)-C)/g;if(Math.abs(x)<1e-6||!isFinite(R)){if(Math.abs(v-y)<1e-6)return this.easeTo(e,i);var A=y<v?-1:1;R=Math.abs(Math.log(y/v))/g,P=function(){return 0},z=function(t){return Math.exp(A*g*t)};}if("duration"in e)e.duration=+e.duration;else{var L="screenSpeed"in e?+e.screenSpeed/g:+e.speed;e.duration=1e3*R/L;}return e.maxDuration&&e.duration>e.maxDuration&&(e.duration=0),this._zooming=!0,this._rotating=a!==c,this._pitching=h!==s,this._prepareEase(i,!1),this._ease(function(e){var u=e*R,d=1/z(u);o.zoom=1===e?l:r+o.scaleZoom(d),n._rotating&&(o.bearing=t.number(a,c,e)),n._pitching&&(o.pitch=t.number(s,h,e));var g=1===e?_:o.unproject(f.add(m.mult(P(u))).mult(d));o.setLocationAtPoint(o.renderWorldCopies?g.wrap():g,p),n._fireMoveEvents(i);},function(){return n._afterEase(i)},e),this},i.prototype.isEasing=function(){return !!this._easeFrameId},i.prototype.stop=function(){if(this._easeFrameId&&(this._cancelRenderFrame(this._easeFrameId),delete this._easeFrameId,delete this._onEaseFrame),this._onEaseEnd){var t=this._onEaseEnd;delete this._onEaseEnd,t.call(this);}return this},i.prototype._ease=function(e,i,n){!1===n.animate||0===n.duration?(e(1),i()):(this._easeStart=t.browser.now(),this._easeOptions=n,this._onEaseFrame=e,this._onEaseEnd=i,this._easeFrameId=this._requestRenderFrame(this._renderFrameCallback));},i.prototype._renderFrameCallback=function(){var e=Math.min((t.browser.now()-this._easeStart)/this._easeOptions.duration,1);this._onEaseFrame(this._easeOptions.easing(e)),e<1?this._easeFrameId=this._requestRenderFrame(this._renderFrameCallback):this.stop();},i.prototype._normalizeBearing=function(e,i){e=t.wrap(e,-180,180);var n=Math.abs(e-i);return Math.abs(e-360-i)<n&&(e-=360),Math.abs(e+360-i)<n&&(e+=360),e},i.prototype._normalizeCenter=function(t){var e=this.transform;if(e.renderWorldCopies&&!e.lngRange){var i=t.lng-e.center.lng;t.lng+=i>180?-360:i<-180?360:0;}},i}(t.Evented),un=function(e){void 0===e&&(e={}),this.options=e,t.bindAll(["_updateEditLink","_updateData","_updateCompact"],this);};un.prototype.getDefaultPosition=function(){return "bottom-right"},un.prototype.onAdd=function(t){var e=this.options&&this.options.compact;return this._map=t,this._container=i.create("div","mapboxgl-ctrl mapboxgl-ctrl-attrib"),e&&this._container.classList.add("mapboxgl-compact"),this._updateAttributions(),this._updateEditLink(),this._map.on("sourcedata",this._updateData),this._map.on("moveend",this._updateEditLink),void 0===e&&(this._map.on("resize",this._updateCompact),this._updateCompact()),this._container},un.prototype.onRemove=function(){i.remove(this._container),this._map.off("sourcedata",this._updateData),this._map.off("moveend",this._updateEditLink),this._map.off("resize",this._updateCompact),this._map=void 0;},un.prototype._updateEditLink=function(){var t=this._editLink;t||(t=this._editLink=this._container.querySelector(".mapbox-improve-map"));var e=[{key:"owner",value:this.styleOwner},{key:"id",value:this.styleId},{key:"access_token",value:u.ACCESS_TOKEN}];if(t){var i=e.reduce(function(t,i,n){return i.value&&(t+=i.key+"="+i.value+(n<e.length-1?"&":"")),t},"?");t.href="https://www.mapbox.com/feedback/"+i+(this._map._hash?this._map._hash.getHashString(!0):"");}},un.prototype._updateData=function(t){t&&"metadata"===t.sourceDataType&&(this._updateAttributions(),this._updateEditLink());},un.prototype._updateAttributions=function(){if(this._map.style){var t=[];if(this.options.customAttribution&&(Array.isArray(this.options.customAttribution)?t=t.concat(this.options.customAttribution):"string"==typeof this.options.customAttribution&&t.push(this.options.customAttribution)),this._map.style.stylesheet){var e=this._map.style.stylesheet;this.styleOwner=e.owner,this.styleId=e.id;}var i=this._map.style.sourceCaches;for(var n in i){var o=i[n].getSource();o.attribution&&t.indexOf(o.attribution)<0&&t.push(o.attribution);}t.sort(function(t,e){return t.length-e.length}),(t=t.filter(function(e,i){for(var n=i+1;n<t.length;n++)if(t[n].indexOf(e)>=0)return !1;return !0})).length?(this._container.innerHTML=t.join(" | "),this._container.classList.remove("mapboxgl-attrib-empty")):this._container.classList.add("mapboxgl-attrib-empty"),this._editLink=null;}},un.prototype._updateCompact=function(){this._map.getCanvasContainer().offsetWidth<=640?this._container.classList.add("mapboxgl-compact"):this._container.classList.remove("mapboxgl-compact");};var pn=function(){t.bindAll(["_updateLogo"],this),t.bindAll(["_updateCompact"],this);};pn.prototype.onAdd=function(t){this._map=t,this._container=i.create("div","mapboxgl-ctrl");var e=i.create("a","mapboxgl-ctrl-logo");return e.target="_blank",e.href="https://www.mapbox.com/",e.setAttribute("aria-label","Mapbox logo"),e.setAttribute("rel","noopener"),this._container.appendChild(e),this._container.style.display="none",this._map.on("sourcedata",this._updateLogo),this._updateLogo(),this._map.on("resize",this._updateCompact),this._updateCompact(),this._container},pn.prototype.onRemove=function(){i.remove(this._container),this._map.off("sourcedata",this._updateLogo),this._map.off("resize",this._updateCompact);},pn.prototype.getDefaultPosition=function(){return "bottom-left"},pn.prototype._updateLogo=function(t){t&&"metadata"!==t.sourceDataType||(this._container.style.display=this._logoRequired()?"block":"none");},pn.prototype._logoRequired=function(){if(this._map.style){var t=this._map.style.sourceCaches;for(var e in t){if(t[e].getSource().mapbox_logo)return !0}return !1}},pn.prototype._updateCompact=function(){var t=this._container.children;if(t.length){var e=t[0];this._map.getCanvasContainer().offsetWidth<250?e.classList.add("mapboxgl-compact"):e.classList.remove("mapboxgl-compact");}};var dn=function(){this._queue=[],this._id=0,this._cleared=!1,this._currentlyRunning=!1;};dn.prototype.add=function(t){var e=++this._id;return this._queue.push({callback:t,id:e,cancelled:!1}),e},dn.prototype.remove=function(t){for(var e=this._currentlyRunning,i=0,n=e?this._queue.concat(e):this._queue;i<n.length;i+=1){var o=n[i];if(o.id===t)return void(o.cancelled=!0)}},dn.prototype.run=function(){var t=this._currentlyRunning=this._queue;this._queue=[];for(var e=0,i=t;e<i.length;e+=1){var n=i[e];if(!n.cancelled&&(n.callback(),this._cleared))break}this._cleared=!1,this._currentlyRunning=!1;},dn.prototype.clear=function(){this._currentlyRunning&&(this._cleared=!0),this._queue=[];};var _n=t.window.HTMLImageElement,fn=t.window.HTMLElement,mn={center:[0,0],zoom:0,bearing:0,pitch:0,minZoom:0,maxZoom:22,interactive:!0,scrollZoom:!0,boxZoom:!0,dragRotate:!0,dragPan:!0,keyboard:!0,doubleClickZoom:!0,touchZoomRotate:!0,bearingSnap:7,clickTolerance:3,hash:!1,attributionControl:!0,failIfMajorPerformanceCaveat:!1,preserveDrawingBuffer:!1,trackResize:!0,renderWorldCopies:!0,refreshExpiredTiles:!0,maxTileCacheSize:null,transformRequest:null,fadeDuration:300,crossSourceCollisions:!0},gn=function(n){function o(e){var o=this;if(null!=(e=t.extend({},mn,e)).minZoom&&null!=e.maxZoom&&e.minZoom>e.maxZoom)throw new Error("maxZoom must be greater than minZoom");var r=new Gi(e.minZoom,e.maxZoom,e.renderWorldCopies);n.call(this,r,e),this._interactive=e.interactive,this._maxTileCacheSize=e.maxTileCacheSize,this._failIfMajorPerformanceCaveat=e.failIfMajorPerformanceCaveat,this._preserveDrawingBuffer=e.preserveDrawingBuffer,this._trackResize=e.trackResize,this._bearingSnap=e.bearingSnap,this._refreshExpiredTiles=e.refreshExpiredTiles,this._fadeDuration=e.fadeDuration,this._crossSourceCollisions=e.crossSourceCollisions,this._crossFadingFactor=1,this._collectResourceTiming=e.collectResourceTiming,this._renderTaskQueue=new dn,this._controls=[];var a=e.transformRequest;if(this._transformRequest=a?function(t,e){return a(t,e)||{url:t}}:function(t){return {url:t}},"string"==typeof e.container){if(this._container=t.window.document.getElementById(e.container),!this._container)throw new Error("Container '"+e.container+"' not found.")}else{if(!(e.container instanceof fn))throw new Error("Invalid type: 'container' must be a String or HTMLElement.");this._container=e.container;}if(e.maxBounds&&this.setMaxBounds(e.maxBounds),t.bindAll(["_onWindowOnline","_onWindowResize","_contextLost","_contextRestored"],this),this._setupContainer(),this._setupPainter(),void 0===this.painter)throw new Error("Failed to initialize WebGL.");this.on("move",function(){return o._update(!1)}),this.on("zoom",function(){return o._update(!0)}),void 0!==t.window&&(t.window.addEventListener("online",this._onWindowOnline,!1),t.window.addEventListener("resize",this._onWindowResize,!1)),function(t,e){var n=t.getCanvasContainer(),o=null,r=!1,a=null;for(var s in cn)t[s]=new cn[s](t,e),e.interactive&&e[s]&&t[s].enable(e[s]);i.addEventListener(n,"mouseout",function(e){t.fire(new Hi("mouseout",t,e));}),i.addEventListener(n,"mousedown",function(o){r=!0,a=i.mousePos(n,o);var s=new Hi("mousedown",t,o);t.fire(s),s.defaultPrevented||(e.interactive&&!t.doubleClickZoom.isActive()&&t.stop(),t.boxZoom.onMouseDown(o),t.boxZoom.isActive()||t.dragPan.isActive()||t.dragRotate.onMouseDown(o),t.boxZoom.isActive()||t.dragRotate.isActive()||t.dragPan.onMouseDown(o));}),i.addEventListener(n,"mouseup",function(e){var i=t.dragRotate.isActive();o&&!i&&t.fire(new Hi("contextmenu",t,o)),o=null,r=!1,t.fire(new Hi("mouseup",t,e));}),i.addEventListener(n,"mousemove",function(e){if(!t.dragPan.isActive()&&!t.dragRotate.isActive()){for(var i=e.target;i&&i!==n;)i=i.parentNode;i===n&&t.fire(new Hi("mousemove",t,e));}}),i.addEventListener(n,"mouseover",function(e){for(var i=e.target;i&&i!==n;)i=i.parentNode;i===n&&t.fire(new Hi("mouseover",t,e));}),i.addEventListener(n,"touchstart",function(i){var n=new Ki("touchstart",t,i);t.fire(n),n.defaultPrevented||(e.interactive&&t.stop(),t.boxZoom.isActive()||t.dragRotate.isActive()||t.dragPan.onTouchStart(i),t.touchZoomRotate.onStart(i),t.doubleClickZoom.onTouchStart(n));},{passive:!1}),i.addEventListener(n,"touchmove",function(e){t.fire(new Ki("touchmove",t,e));},{passive:!1}),i.addEventListener(n,"touchend",function(e){t.fire(new Ki("touchend",t,e));}),i.addEventListener(n,"touchcancel",function(e){t.fire(new Ki("touchcancel",t,e));}),i.addEventListener(n,"click",function(o){var r=i.mousePos(n,o);(r.equals(a)||r.dist(a)<e.clickTolerance)&&t.fire(new Hi("click",t,o));}),i.addEventListener(n,"dblclick",function(e){var i=new Hi("dblclick",t,e);t.fire(i),i.defaultPrevented||t.doubleClickZoom.onDblClick(i);}),i.addEventListener(n,"contextmenu",function(e){var i=t.dragRotate.isActive();r||i?r&&(o=e):t.fire(new Hi("contextmenu",t,e)),e.preventDefault();}),i.addEventListener(n,"wheel",function(i){e.interactive&&t.stop();var n=new Yi("wheel",t,i);t.fire(n),n.defaultPrevented||t.scrollZoom.onWheel(i);},{passive:!1});}(this,e),this._hash=e.hash&&(new Xi).addTo(this),this._hash&&this._hash._onHashChange()||this.jumpTo({center:e.center,zoom:e.zoom,bearing:e.bearing,pitch:e.pitch}),this.resize(),e.style&&this.setStyle(e.style,{localIdeographFontFamily:e.localIdeographFontFamily}),e.attributionControl&&this.addControl(new un({customAttribution:e.customAttribution})),this.addControl(new pn,e.logoPosition),this.on("style.load",function(){o.transform.unmodified&&o.jumpTo(o.style.stylesheet);}),this.on("data",function(e){o._update("style"===e.dataType),o.fire(new t.Event(e.dataType+"data",e));}),this.on("dataloading",function(e){o.fire(new t.Event(e.dataType+"dataloading",e));});}n&&(o.__proto__=n),o.prototype=Object.create(n&&n.prototype),o.prototype.constructor=o;var r={showTileBoundaries:{configurable:!0},showCollisionBoxes:{configurable:!0},showOverdrawInspector:{configurable:!0},repaint:{configurable:!0},vertices:{configurable:!0}};return o.prototype.addControl=function(e,i){if(void 0===i&&e.getDefaultPosition&&(i=e.getDefaultPosition()),void 0===i&&(i="top-right"),!e||!e.onAdd)return this.fire(new t.ErrorEvent(new Error("Invalid argument to map.addControl(). Argument must be a control with onAdd and onRemove methods.")));var n=e.onAdd(this);this._controls.push(e);var o=this._controlPositions[i];return -1!==i.indexOf("bottom")?o.insertBefore(n,o.firstChild):o.appendChild(n),this},o.prototype.removeControl=function(e){if(!e||!e.onRemove)return this.fire(new t.ErrorEvent(new Error("Invalid argument to map.removeControl(). Argument must be a control with onAdd and onRemove methods.")));var i=this._controls.indexOf(e);return i>-1&&this._controls.splice(i,1),e.onRemove(this),this},o.prototype.resize=function(e){var i=this._containerDimensions(),n=i[0],o=i[1];return this._resizeCanvas(n,o),this.transform.resize(n,o),this.painter.resize(n,o),this.fire(new t.Event("movestart",e)).fire(new t.Event("move",e)).fire(new t.Event("resize",e)).fire(new t.Event("moveend",e)),this},o.prototype.getBounds=function(){return this.transform.getBounds()},o.prototype.getMaxBounds=function(){return this.transform.getMaxBounds()},o.prototype.setMaxBounds=function(t){return this.transform.setMaxBounds(N.convert(t)),this._update()},o.prototype.setMinZoom=function(t){if((t=null==t?0:t)>=0&&t<=this.transform.maxZoom)return this.transform.minZoom=t,this._update(),this.getZoom()<t&&this.setZoom(t),this;throw new Error("minZoom must be between 0 and the current maxZoom, inclusive")},o.prototype.getMinZoom=function(){return this.transform.minZoom},o.prototype.setMaxZoom=function(t){if((t=null==t?22:t)>=this.transform.minZoom)return this.transform.maxZoom=t,this._update(),this.getZoom()>t&&this.setZoom(t),this;throw new Error("maxZoom must be greater than the current minZoom")},o.prototype.getRenderWorldCopies=function(){return this.transform.renderWorldCopies},o.prototype.setRenderWorldCopies=function(t){return this.transform.renderWorldCopies=t,this._update()},o.prototype.getMaxZoom=function(){return this.transform.maxZoom},o.prototype.project=function(t){return this.transform.locationPoint(U.convert(t))},o.prototype.unproject=function(e){return this.transform.pointLocation(t.Point.convert(e))},o.prototype.isMoving=function(){return this._moving||this.dragPan.isActive()||this.dragRotate.isActive()||this.scrollZoom.isActive()},o.prototype.isZooming=function(){return this._zooming||this.scrollZoom.isActive()},o.prototype.isRotating=function(){return this._rotating||this.dragRotate.isActive()},o.prototype.on=function(t,e,i){var o,r=this;if(void 0===i)return n.prototype.on.call(this,t,e);var a=function(){if("mouseenter"===t||"mouseover"===t){var n=!1;return {layer:e,listener:i,delegates:{mousemove:function(o){var a=r.getLayer(e)?r.queryRenderedFeatures(o.point,{layers:[e]}):[];a.length?n||(n=!0,i.call(r,new Hi(t,r,o.originalEvent,{features:a}))):n=!1;},mouseout:function(){n=!1;}}}}if("mouseleave"===t||"mouseout"===t){var a=!1;return {layer:e,listener:i,delegates:{mousemove:function(n){(r.getLayer(e)?r.queryRenderedFeatures(n.point,{layers:[e]}):[]).length?a=!0:a&&(a=!1,i.call(r,new Hi(t,r,n.originalEvent)));},mouseout:function(e){a&&(a=!1,i.call(r,new Hi(t,r,e.originalEvent)));}}}}return {layer:e,listener:i,delegates:(o={},o[t]=function(t){var n=r.getLayer(e)?r.queryRenderedFeatures(t.point,{layers:[e]}):[];n.length&&(t.features=n,i.call(r,t),delete t.features);},o)}}();for(var s in this._delegatedListeners=this._delegatedListeners||{},this._delegatedListeners[t]=this._delegatedListeners[t]||[],this._delegatedListeners[t].push(a),a.delegates)r.on(s,a.delegates[s]);return this},o.prototype.off=function(t,e,i){if(void 0===i)return n.prototype.off.call(this,t,e);if(this._delegatedListeners&&this._delegatedListeners[t])for(var o=this._delegatedListeners[t],r=0;r<o.length;r++){var a=o[r];if(a.layer===e&&a.listener===i){for(var s in a.delegates)this.off(s,a.delegates[s]);return o.splice(r,1),this}}return this},o.prototype.queryRenderedFeatures=function(e,i){if(!this.style)return [];var n;if(void 0!==i||void 0===e||e instanceof t.Point||Array.isArray(e)||(i=e,e=void 0),i=i||{},(e=e||[[0,0],[this.transform.width,this.transform.height]])instanceof t.Point||"number"==typeof e[0])n=[t.Point.convert(e)];else{var o=t.Point.convert(e[0]),r=t.Point.convert(e[1]);n=[o,new t.Point(r.x,o.y),r,new t.Point(o.x,r.y),o];}return this.style.queryRenderedFeatures(n,i,this.transform)},o.prototype.querySourceFeatures=function(t,e){return this.style.querySourceFeatures(t,e)},o.prototype.setStyle=function(e,i){if((!i||!1!==i.diff&&!i.localIdeographFontFamily)&&this.style&&e&&"object"==typeof e)try{return this.style.setState(e)&&this._update(!0),this}catch(e){t.warnOnce("Unable to perform style diff: "+(e.message||e.error||e)+".  Rebuilding the style from scratch.");}return this.style&&(this.style.setEventedParent(null),this.style._remove()),e?(this.style=new Ve(this,i||{}),this.style.setEventedParent(this,{style:this.style}),"string"==typeof e?this.style.loadURL(e):this.style.loadJSON(e),this):(delete this.style,this)},o.prototype.getStyle=function(){if(this.style)return this.style.serialize()},o.prototype.isStyleLoaded=function(){return this.style?this.style.loaded():t.warnOnce("There is no style added to the map.")},o.prototype.addSource=function(t,e){return this.style.addSource(t,e),this._update(!0)},o.prototype.isSourceLoaded=function(e){var i=this.style&&this.style.sourceCaches[e];if(void 0!==i)return i.loaded();this.fire(new t.ErrorEvent(new Error("There is no source with ID '"+e+"'")));},o.prototype.areTilesLoaded=function(){var t=this.style&&this.style.sourceCaches;for(var e in t){var i=t[e]._tiles;for(var n in i){var o=i[n];if("loaded"!==o.state&&"errored"!==o.state)return !1}}return !0},o.prototype.addSourceType=function(t,e,i){return this.style.addSourceType(t,e,i)},o.prototype.removeSource=function(t){return this.style.removeSource(t),this._update(!0)},o.prototype.getSource=function(t){return this.style.getSource(t)},o.prototype.addImage=function(e,i,n){void 0===n&&(n={});var o=n.pixelRatio;void 0===o&&(o=1);var r=n.sdf;if(void 0===r&&(r=!1),i instanceof _n){var a=t.browser.getImageData(i),s=a.width,l=a.height,c=a.data;this.style.addImage(e,{data:new t.RGBAImage({width:s,height:l},c),pixelRatio:o,sdf:r});}else{if(void 0===i.width||void 0===i.height)return this.fire(new t.ErrorEvent(new Error("Invalid arguments to map.addImage(). The second argument must be an `HTMLImageElement`, `ImageData`, or object with `width`, `height`, and `data` properties with the same format as `ImageData`")));var h=i.width,u=i.height,p=i.data;this.style.addImage(e,{data:new t.RGBAImage({width:h,height:u},new Uint8Array(p)),pixelRatio:o,sdf:r});}},o.prototype.hasImage=function(e){return e?!!this.style.getImage(e):(this.fire(new t.ErrorEvent(new Error("Missing required image id"))),!1)},o.prototype.removeImage=function(t){this.style.removeImage(t);},o.prototype.loadImage=function(e,i){t.getImage(this._transformRequest(e,t.ResourceType.Image),i);},o.prototype.listImages=function(){return this.style.listImages()},o.prototype.addLayer=function(t,e){return this.style.addLayer(t,e),this._update(!0)},o.prototype.moveLayer=function(t,e){return this.style.moveLayer(t,e),this._update(!0)},o.prototype.removeLayer=function(t){return this.style.removeLayer(t),this._update(!0)},o.prototype.getLayer=function(t){return this.style.getLayer(t)},o.prototype.setFilter=function(t,e){return this.style.setFilter(t,e),this._update(!0)},o.prototype.setLayerZoomRange=function(t,e,i){return this.style.setLayerZoomRange(t,e,i),this._update(!0)},o.prototype.getFilter=function(t){return this.style.getFilter(t)},o.prototype.setPaintProperty=function(t,e,i){return this.style.setPaintProperty(t,e,i),this._update(!0)},o.prototype.getPaintProperty=function(t,e){return this.style.getPaintProperty(t,e)},o.prototype.setLayoutProperty=function(t,e,i){return this.style.setLayoutProperty(t,e,i),this._update(!0)},o.prototype.getLayoutProperty=function(t,e){return this.style.getLayoutProperty(t,e)},o.prototype.setLight=function(t){return this.style.setLight(t),this._update(!0)},o.prototype.getLight=function(){return this.style.getLight()},o.prototype.setFeatureState=function(t,e){return this.style.setFeatureState(t,e),this._update()},o.prototype.getFeatureState=function(t){return this.style.getFeatureState(t)},o.prototype.getContainer=function(){return this._container},o.prototype.getCanvasContainer=function(){return this._canvasContainer},o.prototype.getCanvas=function(){return this._canvas},o.prototype._containerDimensions=function(){var t=0,e=0;return this._container&&(t=this._container.clientWidth||400,e=this._container.clientHeight||300),[t,e]},o.prototype._detectMissingCSS=function(){"rgb(250, 128, 114)"!==t.window.getComputedStyle(this._missingCSSCanary).getPropertyValue("background-color")&&t.warnOnce("This page appears to be missing CSS declarations for Mapbox GL JS, which may cause the map to display incorrectly. Please ensure your page includes mapbox-gl.css, as described in https://www.mapbox.com/mapbox-gl-js/api/.");},o.prototype._setupContainer=function(){var t=this._container;t.classList.add("mapboxgl-map"),(this._missingCSSCanary=i.create("div","mapboxgl-canary",t)).style.visibility="hidden",this._detectMissingCSS();var e=this._canvasContainer=i.create("div","mapboxgl-canvas-container",t);this._interactive&&e.classList.add("mapboxgl-interactive"),this._canvas=i.create("canvas","mapboxgl-canvas",e),this._canvas.style.position="absolute",this._canvas.addEventListener("webglcontextlost",this._contextLost,!1),this._canvas.addEventListener("webglcontextrestored",this._contextRestored,!1),this._canvas.setAttribute("tabindex","0"),this._canvas.setAttribute("aria-label","Map");var n=this._containerDimensions();this._resizeCanvas(n[0],n[1]);var o=this._controlContainer=i.create("div","mapboxgl-control-container",t),r=this._controlPositions={};["top-left","top-right","bottom-left","bottom-right"].forEach(function(t){r[t]=i.create("div","mapboxgl-ctrl-"+t,o);});},o.prototype._resizeCanvas=function(e,i){var n=t.window.devicePixelRatio||1;this._canvas.width=n*e,this._canvas.height=n*i,this._canvas.style.width=e+"px",this._canvas.style.height=i+"px";},o.prototype._setupPainter=function(){var i=t.extend({failIfMajorPerformanceCaveat:this._failIfMajorPerformanceCaveat,preserveDrawingBuffer:this._preserveDrawingBuffer},e.webGLContextAttributes),n=this._canvas.getContext("webgl",i)||this._canvas.getContext("experimental-webgl",i);n?this.painter=new Zi(n,this.transform):this.fire(new t.ErrorEvent(new Error("Failed to initialize WebGL")));},o.prototype._contextLost=function(e){e.preventDefault(),this._frame&&(this._frame.cancel(),this._frame=null),this.fire(new t.Event("webglcontextlost",{originalEvent:e}));},o.prototype._contextRestored=function(e){this._setupPainter(),this.resize(),this._update(),this.fire(new t.Event("webglcontextrestored",{originalEvent:e}));},o.prototype.loaded=function(){return !this._styleDirty&&!this._sourcesDirty&&!!this.style&&this.style.loaded()},o.prototype._update=function(t){return this.style?(this._styleDirty=this._styleDirty||t,this._sourcesDirty=!0,this._rerender(),this):this},o.prototype._requestRenderFrame=function(t){return this._update(),this._renderTaskQueue.add(t)},o.prototype._cancelRenderFrame=function(t){this._renderTaskQueue.remove(t);},o.prototype._render=function(){this._renderTaskQueue.run();var e=!1;if(this.style&&this._styleDirty){this._styleDirty=!1;var i=this.transform.zoom,n=t.browser.now();this.style.zoomHistory.update(i,n);var o=new t.EvaluationParameters(i,{now:n,fadeDuration:this._fadeDuration,zoomHistory:this.style.zoomHistory,transition:this.style.getTransition()}),r=o.crossFadingFactor();1===r&&r===this._crossFadingFactor||(e=!0,this._crossFadingFactor=r),this.style.update(o);}return this.style&&this._sourcesDirty&&(this._sourcesDirty=!1,this.style._updateSources(this.transform)),this._placementDirty=this.style&&this.style._updatePlacement(this.painter.transform,this.showCollisionBoxes,this._fadeDuration,this._crossSourceCollisions),this.painter.render(this.style,{showTileBoundaries:this.showTileBoundaries,showOverdrawInspector:this._showOverdrawInspector,rotating:this.isRotating(),zooming:this.isZooming(),fadeDuration:this._fadeDuration}),this.fire(new t.Event("render")),this.loaded()&&!this._loaded&&(this._loaded=!0,this.fire(new t.Event("load"))),this.style&&(this.style.hasTransitions()||e)&&(this._styleDirty=!0),this.style&&!this._placementDirty&&this.style._releaseSymbolFadeTiles(),(this._sourcesDirty||this._repaint||this._styleDirty||this._placementDirty)&&this._rerender(),this},o.prototype.remove=function(){this._hash&&this._hash.remove(),this._frame&&(this._frame.cancel(),this._frame=null),this._renderTaskQueue.clear(),this.setStyle(null),void 0!==t.window&&(t.window.removeEventListener("resize",this._onWindowResize,!1),t.window.removeEventListener("online",this._onWindowOnline,!1));for(var e=0,i=this._controls;e<i.length;e+=1){i[e].onRemove(this);}this._controls=[];var n=this.painter.context.gl.getExtension("WEBGL_lose_context");n&&n.loseContext(),vn(this._canvasContainer),vn(this._controlContainer),vn(this._missingCSSCanary),this._container.classList.remove("mapboxgl-map"),this.fire(new t.Event("remove"));},o.prototype._rerender=function(){var e=this;this.style&&!this._frame&&(this._frame=t.browser.frame(function(){e._frame=null,e._render();}));},o.prototype._onWindowOnline=function(){this._update();},o.prototype._onWindowResize=function(){this._trackResize&&this.resize()._update();},r.showTileBoundaries.get=function(){return !!this._showTileBoundaries},r.showTileBoundaries.set=function(t){this._showTileBoundaries!==t&&(this._showTileBoundaries=t,this._update());},r.showCollisionBoxes.get=function(){return !!this._showCollisionBoxes},r.showCollisionBoxes.set=function(t){this._showCollisionBoxes!==t&&(this._showCollisionBoxes=t,t?this.style._generateCollisionBoxes():this._update());},r.showOverdrawInspector.get=function(){return !!this._showOverdrawInspector},r.showOverdrawInspector.set=function(t){this._showOverdrawInspector!==t&&(this._showOverdrawInspector=t,this._update());},r.repaint.get=function(){return !!this._repaint},r.repaint.set=function(t){this._repaint=t,this._update();},r.vertices.get=function(){return !!this._vertices},r.vertices.set=function(t){this._vertices=t,this._update();},Object.defineProperties(o.prototype,r),o}(hn);function vn(t){t.parentNode&&t.parentNode.removeChild(t);}var yn={showCompass:!0,showZoom:!0},xn=function(e){var n=this;this.options=t.extend({},yn,e),this._container=i.create("div","mapboxgl-ctrl mapboxgl-ctrl-group"),this._container.addEventListener("contextmenu",function(t){return t.preventDefault()}),this.options.showZoom&&(this._zoomInButton=this._createButton("mapboxgl-ctrl-icon mapboxgl-ctrl-zoom-in","Zoom In",function(){return n._map.zoomIn()}),this._zoomOutButton=this._createButton("mapboxgl-ctrl-icon mapboxgl-ctrl-zoom-out","Zoom Out",function(){return n._map.zoomOut()})),this.options.showCompass&&(t.bindAll(["_rotateCompassArrow"],this),this._compass=this._createButton("mapboxgl-ctrl-icon mapboxgl-ctrl-compass","Reset North",function(){return n._map.resetNorth()}),this._compassArrow=i.create("span","mapboxgl-ctrl-compass-arrow",this._compass));};function bn(t,e,i){if(t=new U(t.lng,t.lat),e){var n=new U(t.lng-360,t.lat),o=new U(t.lng+360,t.lat),r=i.locationPoint(t).distSqr(e);i.locationPoint(n).distSqr(e)<r?t=n:i.locationPoint(o).distSqr(e)<r&&(t=o);}for(;Math.abs(t.lng-i.center.lng)>180;){var a=i.locationPoint(t);if(a.x>=0&&a.y>=0&&a.x<=i.width&&a.y<=i.height)break;t.lng>i.center.lng?t.lng-=360:t.lng+=360;}return t}xn.prototype._rotateCompassArrow=function(){var t="rotate("+this._map.transform.angle*(180/Math.PI)+"deg)";this._compassArrow.style.transform=t;},xn.prototype.onAdd=function(t){return this._map=t,this.options.showCompass&&(this._map.on("rotate",this._rotateCompassArrow),this._rotateCompassArrow(),this._handler=new tn(t,{button:"left",element:this._compass}),i.addEventListener(this._compass,"mousedown",this._handler.onMouseDown),this._handler.enable()),this._container},xn.prototype.onRemove=function(){i.remove(this._container),this.options.showCompass&&(this._map.off("rotate",this._rotateCompassArrow),i.removeEventListener(this._compass,"mousedown",this._handler.onMouseDown),this._handler.disable(),delete this._handler),delete this._map;},xn.prototype._createButton=function(t,e,n){var o=i.create("button",t,this._container);return o.type="button",o.setAttribute("aria-label",e),o.addEventListener("click",n),o};var wn={center:"translate(-50%,-50%)",top:"translate(-50%,0)","top-left":"translate(0,0)","top-right":"translate(-100%,0)",bottom:"translate(-50%,-100%)","bottom-left":"translate(0,-100%)","bottom-right":"translate(-100%,-100%)",left:"translate(0,-50%)",right:"translate(-100%,-50%)"};function En(t,e,i){var n=t.classList;for(var o in wn)n.remove("mapboxgl-"+i+"-anchor-"+o);n.add("mapboxgl-"+i+"-anchor-"+e);}var Tn,Sn=function(e){function n(n){if(e.call(this),(arguments[0]instanceof t.window.HTMLElement||2===arguments.length)&&(n=t.extend({element:n},arguments[1])),t.bindAll(["_update","_onMove","_onUp","_addDragHandler","_onMapClick"],this),this._anchor=n&&n.anchor||"center",this._color=n&&n.color||"#3FB1CE",this._draggable=n&&n.draggable||!1,this._state="inactive",n&&n.element)this._element=n.element,this._offset=t.Point.convert(n&&n.offset||[0,0]);else{this._defaultMarker=!0,this._element=i.create("div");var o=i.createNS("http://www.w3.org/2000/svg","svg");o.setAttributeNS(null,"height","41px"),o.setAttributeNS(null,"width","27px"),o.setAttributeNS(null,"viewBox","0 0 27 41");var r=i.createNS("http://www.w3.org/2000/svg","g");r.setAttributeNS(null,"stroke","none"),r.setAttributeNS(null,"stroke-width","1"),r.setAttributeNS(null,"fill","none"),r.setAttributeNS(null,"fill-rule","evenodd");var a=i.createNS("http://www.w3.org/2000/svg","g");a.setAttributeNS(null,"fill-rule","nonzero");var s=i.createNS("http://www.w3.org/2000/svg","g");s.setAttributeNS(null,"transform","translate(3.0, 29.0)"),s.setAttributeNS(null,"fill","#000000");for(var l=0,c=[{rx:"10.5",ry:"5.25002273"},{rx:"10.5",ry:"5.25002273"},{rx:"9.5",ry:"4.77275007"},{rx:"8.5",ry:"4.29549936"},{rx:"7.5",ry:"3.81822308"},{rx:"6.5",ry:"3.34094679"},{rx:"5.5",ry:"2.86367051"},{rx:"4.5",ry:"2.38636864"}];l<c.length;l+=1){var h=c[l],u=i.createNS("http://www.w3.org/2000/svg","ellipse");u.setAttributeNS(null,"opacity","0.04"),u.setAttributeNS(null,"cx","10.5"),u.setAttributeNS(null,"cy","5.80029008"),u.setAttributeNS(null,"rx",h.rx),u.setAttributeNS(null,"ry",h.ry),s.appendChild(u);}var p=i.createNS("http://www.w3.org/2000/svg","g");p.setAttributeNS(null,"fill",this._color);var d=i.createNS("http://www.w3.org/2000/svg","path");d.setAttributeNS(null,"d","M27,13.5 C27,19.074644 20.250001,27.000002 14.75,34.500002 C14.016665,35.500004 12.983335,35.500004 12.25,34.500002 C6.7499993,27.000002 0,19.222562 0,13.5 C0,6.0441559 6.0441559,0 13.5,0 C20.955844,0 27,6.0441559 27,13.5 Z"),p.appendChild(d);var _=i.createNS("http://www.w3.org/2000/svg","g");_.setAttributeNS(null,"opacity","0.25"),_.setAttributeNS(null,"fill","#000000");var f=i.createNS("http://www.w3.org/2000/svg","path");f.setAttributeNS(null,"d","M13.5,0 C6.0441559,0 0,6.0441559 0,13.5 C0,19.222562 6.7499993,27 12.25,34.5 C13,35.522727 14.016664,35.500004 14.75,34.5 C20.250001,27 27,19.074644 27,13.5 C27,6.0441559 20.955844,0 13.5,0 Z M13.5,1 C20.415404,1 26,6.584596 26,13.5 C26,15.898657 24.495584,19.181431 22.220703,22.738281 C19.945823,26.295132 16.705119,30.142167 13.943359,33.908203 C13.743445,34.180814 13.612715,34.322738 13.5,34.441406 C13.387285,34.322738 13.256555,34.180814 13.056641,33.908203 C10.284481,30.127985 7.4148684,26.314159 5.015625,22.773438 C2.6163816,19.232715 1,15.953538 1,13.5 C1,6.584596 6.584596,1 13.5,1 Z"),_.appendChild(f);var m=i.createNS("http://www.w3.org/2000/svg","g");m.setAttributeNS(null,"transform","translate(6.0, 7.0)"),m.setAttributeNS(null,"fill","#FFFFFF");var g=i.createNS("http://www.w3.org/2000/svg","g");g.setAttributeNS(null,"transform","translate(8.0, 8.0)");var v=i.createNS("http://www.w3.org/2000/svg","circle");v.setAttributeNS(null,"fill","#000000"),v.setAttributeNS(null,"opacity","0.25"),v.setAttributeNS(null,"cx","5.5"),v.setAttributeNS(null,"cy","5.5"),v.setAttributeNS(null,"r","5.4999962");var y=i.createNS("http://www.w3.org/2000/svg","circle");y.setAttributeNS(null,"fill","#FFFFFF"),y.setAttributeNS(null,"cx","5.5"),y.setAttributeNS(null,"cy","5.5"),y.setAttributeNS(null,"r","5.4999962"),g.appendChild(v),g.appendChild(y),a.appendChild(s),a.appendChild(p),a.appendChild(_),a.appendChild(m),a.appendChild(g),o.appendChild(a),this._element.appendChild(o),this._offset=t.Point.convert(n&&n.offset||[0,-14]);}this._element.classList.add("mapboxgl-marker"),this._popup=null;}return e&&(n.__proto__=e),n.prototype=Object.create(e&&e.prototype),n.prototype.constructor=n,n.prototype.addTo=function(t){return this.remove(),this._map=t,t.getCanvasContainer().appendChild(this._element),t.on("move",this._update),t.on("moveend",this._update),this.setDraggable(this._draggable),this._update(),this._map.on("click",this._onMapClick),this},n.prototype.remove=function(){return this._map&&(this._map.off("click",this._onMapClick),this._map.off("move",this._update),this._map.off("moveend",this._update),this._map.off("mousedown",this._addDragHandler),this._map.off("touchstart",this._addDragHandler),delete this._map),i.remove(this._element),this._popup&&this._popup.remove(),this},n.prototype.getLngLat=function(){return this._lngLat},n.prototype.setLngLat=function(t){return this._lngLat=U.convert(t),this._pos=null,this._popup&&this._popup.setLngLat(this._lngLat),this._update(),this},n.prototype.getElement=function(){return this._element},n.prototype.setPopup=function(t){if(this._popup&&(this._popup.remove(),this._popup=null),t){if(!("offset"in t.options)){var e=Math.sqrt(Math.pow(13.5,2)/2);t.options.offset=this._defaultMarker?{top:[0,0],"top-left":[0,0],"top-right":[0,0],bottom:[0,-38.1],"bottom-left":[e,-1*(24.6+e)],"bottom-right":[-e,-1*(24.6+e)],left:[13.5,-24.6],right:[-13.5,-24.6]}:this._offset;}this._popup=t,this._lngLat&&this._popup.setLngLat(this._lngLat);}return this},n.prototype._onMapClick=function(t){var e=t.originalEvent.target,i=this._element;this._popup&&(e===i||i.contains(e))&&this.togglePopup();},n.prototype.getPopup=function(){return this._popup},n.prototype.togglePopup=function(){var t=this._popup;return t?(t.isOpen()?t.remove():t.addTo(this._map),this):this},n.prototype._update=function(t){this._map&&(this._map.transform.renderWorldCopies&&(this._lngLat=bn(this._lngLat,this._pos,this._map.transform)),this._pos=this._map.project(this._lngLat)._add(this._offset),t&&"moveend"!==t.type||(this._pos=this._pos.round()),i.setTransform(this._element,wn[this._anchor]+" translate("+this._pos.x+"px, "+this._pos.y+"px)"),En(this._element,this._anchor,"marker"));},n.prototype.getOffset=function(){return this._offset},n.prototype.setOffset=function(e){return this._offset=t.Point.convert(e),this._update(),this},n.prototype._onMove=function(e){this._pos=e.point.sub(this._positionDelta),this._lngLat=this._map.unproject(this._pos),this.setLngLat(this._lngLat),this._element.style.pointerEvents="none","pending"===this._state&&(this._state="active",this.fire(new t.Event("dragstart"))),this.fire(new t.Event("drag"));},n.prototype._onUp=function(){this._element.style.pointerEvents="auto",this._positionDelta=null,this._map.off("mousemove",this._onMove),this._map.off("touchmove",this._onMove),"active"===this._state&&this.fire(new t.Event("dragend")),this._state="inactive";},n.prototype._addDragHandler=function(t){this._element.contains(t.originalEvent.target)&&(t.preventDefault(),this._positionDelta=t.point.sub(this._pos).add(this._offset),this._state="pending",this._map.on("mousemove",this._onMove),this._map.on("touchmove",this._onMove),this._map.once("mouseup",this._onUp),this._map.once("touchend",this._onUp));},n.prototype.setDraggable=function(t){return this._draggable=!!t,this._map&&(t?(this._map.on("mousedown",this._addDragHandler),this._map.on("touchstart",this._addDragHandler)):(this._map.off("mousedown",this._addDragHandler),this._map.off("touchstart",this._addDragHandler))),this},n.prototype.isDraggable=function(){return this._draggable},n}(t.Evented),In={positionOptions:{enableHighAccuracy:!1,maximumAge:0,timeout:6e3},fitBoundsOptions:{maxZoom:15},trackUserLocation:!1,showUserLocation:!0};var Cn=function(e){function n(i){e.call(this),this.options=t.extend({},In,i),t.bindAll(["_onSuccess","_onError","_finish","_setupUI","_updateCamera","_updateMarker"],this);}return e&&(n.__proto__=e),n.prototype=Object.create(e&&e.prototype),n.prototype.constructor=n,n.prototype.onAdd=function(e){var n;return this._map=e,this._container=i.create("div","mapboxgl-ctrl mapboxgl-ctrl-group"),n=this._setupUI,void 0!==Tn?n(Tn):void 0!==t.window.navigator.permissions?t.window.navigator.permissions.query({name:"geolocation"}).then(function(t){Tn="denied"!==t.state,n(Tn);}):(Tn=!!t.window.navigator.geolocation,n(Tn)),this._container},n.prototype.onRemove=function(){void 0!==this._geolocationWatchID&&(t.window.navigator.geolocation.clearWatch(this._geolocationWatchID),this._geolocationWatchID=void 0),this.options.showUserLocation&&this._userLocationDotMarker&&this._userLocationDotMarker.remove(),i.remove(this._container),this._map=void 0;},n.prototype._onSuccess=function(e){if(this.options.trackUserLocation)switch(this._lastKnownPosition=e,this._watchState){case"WAITING_ACTIVE":case"ACTIVE_LOCK":case"ACTIVE_ERROR":this._watchState="ACTIVE_LOCK",this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-waiting"),this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-active-error"),this._geolocateButton.classList.add("mapboxgl-ctrl-geolocate-active");break;case"BACKGROUND":case"BACKGROUND_ERROR":this._watchState="BACKGROUND",this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-waiting"),this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-background-error"),this._geolocateButton.classList.add("mapboxgl-ctrl-geolocate-background");}this.options.showUserLocation&&"OFF"!==this._watchState&&this._updateMarker(e),this.options.trackUserLocation&&"ACTIVE_LOCK"!==this._watchState||this._updateCamera(e),this.options.showUserLocation&&this._dotElement.classList.remove("mapboxgl-user-location-dot-stale"),this.fire(new t.Event("geolocate",e)),this._finish();},n.prototype._updateCamera=function(t){var e=new U(t.coords.longitude,t.coords.latitude),i=t.coords.accuracy;this._map.fitBounds(e.toBounds(i),this.options.fitBoundsOptions,{geolocateSource:!0});},n.prototype._updateMarker=function(t){t?this._userLocationDotMarker.setLngLat([t.coords.longitude,t.coords.latitude]).addTo(this._map):this._userLocationDotMarker.remove();},n.prototype._onError=function(e){if(this.options.trackUserLocation)if(1===e.code)this._watchState="OFF",this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-waiting"),this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-active"),this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-active-error"),this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-background"),this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-background-error"),void 0!==this._geolocationWatchID&&this._clearWatch();else switch(this._watchState){case"WAITING_ACTIVE":this._watchState="ACTIVE_ERROR",this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-active"),this._geolocateButton.classList.add("mapboxgl-ctrl-geolocate-active-error");break;case"ACTIVE_LOCK":this._watchState="ACTIVE_ERROR",this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-active"),this._geolocateButton.classList.add("mapboxgl-ctrl-geolocate-active-error"),this._geolocateButton.classList.add("mapboxgl-ctrl-geolocate-waiting");break;case"BACKGROUND":this._watchState="BACKGROUND_ERROR",this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-background"),this._geolocateButton.classList.add("mapboxgl-ctrl-geolocate-background-error"),this._geolocateButton.classList.add("mapboxgl-ctrl-geolocate-waiting");}"OFF"!==this._watchState&&this.options.showUserLocation&&this._dotElement.classList.add("mapboxgl-user-location-dot-stale"),this.fire(new t.Event("error",e)),this._finish();},n.prototype._finish=function(){this._timeoutId&&clearTimeout(this._timeoutId),this._timeoutId=void 0;},n.prototype._setupUI=function(e){var n=this;!1!==e?(this._container.addEventListener("contextmenu",function(t){return t.preventDefault()}),this._geolocateButton=i.create("button","mapboxgl-ctrl-icon mapboxgl-ctrl-geolocate",this._container),this._geolocateButton.type="button",this._geolocateButton.setAttribute("aria-label","Geolocate"),this.options.trackUserLocation&&(this._geolocateButton.setAttribute("aria-pressed","false"),this._watchState="OFF"),this.options.showUserLocation&&(this._dotElement=i.create("div","mapboxgl-user-location-dot"),this._userLocationDotMarker=new Sn(this._dotElement),this.options.trackUserLocation&&(this._watchState="OFF")),this._geolocateButton.addEventListener("click",this.trigger.bind(this)),this._setup=!0,this.options.trackUserLocation&&this._map.on("movestart",function(e){e.geolocateSource||"ACTIVE_LOCK"!==n._watchState||(n._watchState="BACKGROUND",n._geolocateButton.classList.add("mapboxgl-ctrl-geolocate-background"),n._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-active"),n.fire(new t.Event("trackuserlocationend")));})):t.warnOnce("Geolocation support is not available, the GeolocateControl will not be visible.");},n.prototype.trigger=function(){if(!this._setup)return t.warnOnce("Geolocate control triggered before added to a map"),!1;if(this.options.trackUserLocation){switch(this._watchState){case"OFF":this._watchState="WAITING_ACTIVE",this.fire(new t.Event("trackuserlocationstart"));break;case"WAITING_ACTIVE":case"ACTIVE_LOCK":case"ACTIVE_ERROR":case"BACKGROUND_ERROR":this._watchState="OFF",this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-waiting"),this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-active"),this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-active-error"),this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-background"),this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-background-error"),this.fire(new t.Event("trackuserlocationend"));break;case"BACKGROUND":this._watchState="ACTIVE_LOCK",this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-background"),this._lastKnownPosition&&this._updateCamera(this._lastKnownPosition),this.fire(new t.Event("trackuserlocationstart"));}switch(this._watchState){case"WAITING_ACTIVE":this._geolocateButton.classList.add("mapboxgl-ctrl-geolocate-waiting"),this._geolocateButton.classList.add("mapboxgl-ctrl-geolocate-active");break;case"ACTIVE_LOCK":this._geolocateButton.classList.add("mapboxgl-ctrl-geolocate-active");break;case"ACTIVE_ERROR":this._geolocateButton.classList.add("mapboxgl-ctrl-geolocate-waiting"),this._geolocateButton.classList.add("mapboxgl-ctrl-geolocate-active-error");break;case"BACKGROUND":this._geolocateButton.classList.add("mapboxgl-ctrl-geolocate-background");break;case"BACKGROUND_ERROR":this._geolocateButton.classList.add("mapboxgl-ctrl-geolocate-waiting"),this._geolocateButton.classList.add("mapboxgl-ctrl-geolocate-background-error");}"OFF"===this._watchState&&void 0!==this._geolocationWatchID?this._clearWatch():void 0===this._geolocationWatchID&&(this._geolocateButton.classList.add("mapboxgl-ctrl-geolocate-waiting"),this._geolocateButton.setAttribute("aria-pressed","true"),this._geolocationWatchID=t.window.navigator.geolocation.watchPosition(this._onSuccess,this._onError,this.options.positionOptions));}else t.window.navigator.geolocation.getCurrentPosition(this._onSuccess,this._onError,this.options.positionOptions),this._timeoutId=setTimeout(this._finish,1e4);return !0},n.prototype._clearWatch=function(){t.window.navigator.geolocation.clearWatch(this._geolocationWatchID),this._geolocationWatchID=void 0,this._geolocateButton.classList.remove("mapboxgl-ctrl-geolocate-waiting"),this._geolocateButton.setAttribute("aria-pressed","false"),this.options.showUserLocation&&this._updateMarker(null);},n}(t.Evented),zn={maxWidth:100,unit:"metric"},Pn=function(e){this.options=t.extend({},zn,e),t.bindAll(["_onMove","setUnit"],this);};function Rn(t,e,i){var n,o,r,a,s,l,c=i&&i.maxWidth||100,h=t._container.clientHeight/2,u=(n=t.unproject([0,h]),o=t.unproject([c,h]),r=Math.PI/180,a=n.lat*r,s=o.lat*r,l=Math.sin(a)*Math.sin(s)+Math.cos(a)*Math.cos(s)*Math.cos((o.lng-n.lng)*r),6371e3*Math.acos(Math.min(l,1)));if(i&&"imperial"===i.unit){var p=3.2808*u;if(p>5280)An(e,c,p/5280,"mi");else An(e,c,p,"ft");}else if(i&&"nautical"===i.unit){An(e,c,u/1852,"nm");}else An(e,c,u,"m");}function An(t,e,i,n){var o,r,a,s=(o=i,(r=Math.pow(10,(""+Math.floor(o)).length-1))*(a=(a=o/r)>=10?10:a>=5?5:a>=3?3:a>=2?2:1)),l=s/i;"m"===n&&s>=1e3&&(s/=1e3,n="km"),t.style.width=e*l+"px",t.innerHTML=s+n;}Pn.prototype.getDefaultPosition=function(){return "bottom-left"},Pn.prototype._onMove=function(){Rn(this._map,this._container,this.options);},Pn.prototype.onAdd=function(t){return this._map=t,this._container=i.create("div","mapboxgl-ctrl mapboxgl-ctrl-scale",t.getContainer()),this._map.on("move",this._onMove),this._onMove(),this._container},Pn.prototype.onRemove=function(){i.remove(this._container),this._map.off("move",this._onMove),this._map=void 0;},Pn.prototype.setUnit=function(t){this.options.unit=t,Rn(this._map,this._container,this.options);};var Ln=function(){this._fullscreen=!1,t.bindAll(["_onClickFullscreen","_changeIcon"],this),"onfullscreenchange"in t.window.document?this._fullscreenchange="fullscreenchange":"onmozfullscreenchange"in t.window.document?this._fullscreenchange="mozfullscreenchange":"onwebkitfullscreenchange"in t.window.document?this._fullscreenchange="webkitfullscreenchange":"onmsfullscreenchange"in t.window.document&&(this._fullscreenchange="MSFullscreenChange"),this._className="mapboxgl-ctrl";};Ln.prototype.onAdd=function(e){return this._map=e,this._mapContainer=this._map.getContainer(),this._container=i.create("div",this._className+" mapboxgl-ctrl-group"),this._checkFullscreenSupport()?this._setupUI():(this._container.style.display="none",t.warnOnce("This device does not support fullscreen mode.")),this._container},Ln.prototype.onRemove=function(){i.remove(this._container),this._map=null,t.window.document.removeEventListener(this._fullscreenchange,this._changeIcon);},Ln.prototype._checkFullscreenSupport=function(){return !!(t.window.document.fullscreenEnabled||t.window.document.mozFullScreenEnabled||t.window.document.msFullscreenEnabled||t.window.document.webkitFullscreenEnabled)},Ln.prototype._setupUI=function(){var e=this._fullscreenButton=i.create("button",this._className+"-icon "+this._className+"-fullscreen",this._container);e.setAttribute("aria-label","Toggle fullscreen"),e.type="button",this._fullscreenButton.addEventListener("click",this._onClickFullscreen),t.window.document.addEventListener(this._fullscreenchange,this._changeIcon);},Ln.prototype._isFullscreen=function(){return this._fullscreen},Ln.prototype._changeIcon=function(){(t.window.document.fullscreenElement||t.window.document.mozFullScreenElement||t.window.document.webkitFullscreenElement||t.window.document.msFullscreenElement)===this._mapContainer!==this._fullscreen&&(this._fullscreen=!this._fullscreen,this._fullscreenButton.classList.toggle(this._className+"-shrink"),this._fullscreenButton.classList.toggle(this._className+"-fullscreen"));},Ln.prototype._onClickFullscreen=function(){this._isFullscreen()?t.window.document.exitFullscreen?t.window.document.exitFullscreen():t.window.document.mozCancelFullScreen?t.window.document.mozCancelFullScreen():t.window.document.msExitFullscreen?t.window.document.msExitFullscreen():t.window.document.webkitCancelFullScreen&&t.window.document.webkitCancelFullScreen():this._mapContainer.requestFullscreen?this._mapContainer.requestFullscreen():this._mapContainer.mozRequestFullScreen?this._mapContainer.mozRequestFullScreen():this._mapContainer.msRequestFullscreen?this._mapContainer.msRequestFullscreen():this._mapContainer.webkitRequestFullscreen&&this._mapContainer.webkitRequestFullscreen();};var Dn={closeButton:!0,closeOnClick:!0,className:""},Mn=function(e){function n(i){e.call(this),this.options=t.extend(Object.create(Dn),i),t.bindAll(["_update","_onClickClose"],this);}return e&&(n.__proto__=e),n.prototype=Object.create(e&&e.prototype),n.prototype.constructor=n,n.prototype.addTo=function(e){return this._map=e,this._map.on("move",this._update),this.options.closeOnClick&&this._map.on("click",this._onClickClose),this._update(),this.fire(new t.Event("open")),this},n.prototype.isOpen=function(){return !!this._map},n.prototype.remove=function(){return this._content&&i.remove(this._content),this._container&&(i.remove(this._container),delete this._container),this._map&&(this._map.off("move",this._update),this._map.off("click",this._onClickClose),delete this._map),this.fire(new t.Event("close")),this},n.prototype.getLngLat=function(){return this._lngLat},n.prototype.setLngLat=function(t){return this._lngLat=U.convert(t),this._pos=null,this._update(),this},n.prototype.setText=function(e){return this.setDOMContent(t.window.document.createTextNode(e))},n.prototype.setHTML=function(e){var i,n=t.window.document.createDocumentFragment(),o=t.window.document.createElement("body");for(o.innerHTML=e;i=o.firstChild;)n.appendChild(i);return this.setDOMContent(n)},n.prototype.setDOMContent=function(t){return this._createContent(),this._content.appendChild(t),this._update(),this},n.prototype._createContent=function(){this._content&&i.remove(this._content),this._content=i.create("div","mapboxgl-popup-content",this._container),this.options.closeButton&&(this._closeButton=i.create("button","mapboxgl-popup-close-button",this._content),this._closeButton.type="button",this._closeButton.setAttribute("aria-label","Close popup"),this._closeButton.innerHTML="&#215;",this._closeButton.addEventListener("click",this._onClickClose));},n.prototype._update=function(){var e=this;if(this._map&&this._lngLat&&this._content){this._container||(this._container=i.create("div","mapboxgl-popup",this._map.getContainer()),this._tip=i.create("div","mapboxgl-popup-tip",this._container),this._container.appendChild(this._content),this.options.className&&this.options.className.split(" ").forEach(function(t){return e._container.classList.add(t)})),this._map.transform.renderWorldCopies&&(this._lngLat=bn(this._lngLat,this._pos,this._map.transform));var n=this._pos=this._map.project(this._lngLat),o=this.options.anchor,r=function e(i){if(i){if("number"==typeof i){var n=Math.round(Math.sqrt(.5*Math.pow(i,2)));return {center:new t.Point(0,0),top:new t.Point(0,i),"top-left":new t.Point(n,n),"top-right":new t.Point(-n,n),bottom:new t.Point(0,-i),"bottom-left":new t.Point(n,-n),"bottom-right":new t.Point(-n,-n),left:new t.Point(i,0),right:new t.Point(-i,0)}}if(i instanceof t.Point||Array.isArray(i)){var o=t.Point.convert(i);return {center:o,top:o,"top-left":o,"top-right":o,bottom:o,"bottom-left":o,"bottom-right":o,left:o,right:o}}return {center:t.Point.convert(i.center||[0,0]),top:t.Point.convert(i.top||[0,0]),"top-left":t.Point.convert(i["top-left"]||[0,0]),"top-right":t.Point.convert(i["top-right"]||[0,0]),bottom:t.Point.convert(i.bottom||[0,0]),"bottom-left":t.Point.convert(i["bottom-left"]||[0,0]),"bottom-right":t.Point.convert(i["bottom-right"]||[0,0]),left:t.Point.convert(i.left||[0,0]),right:t.Point.convert(i.right||[0,0])}}return e(new t.Point(0,0))}(this.options.offset);if(!o){var a,s=this._container.offsetWidth,l=this._container.offsetHeight;a=n.y+r.bottom.y<l?["top"]:n.y>this._map.transform.height-l?["bottom"]:[],n.x<s/2?a.push("left"):n.x>this._map.transform.width-s/2&&a.push("right"),o=0===a.length?"bottom":a.join("-");}var c=n.add(r[o]).round();i.setTransform(this._container,wn[o]+" translate("+c.x+"px,"+c.y+"px)"),En(this._container,o,"popup");}},n.prototype._onClickClose=function(){this.remove();},n}(t.Evented);var kn={version:"0.49.0",supported:e,setRTLTextPlugin:t.setRTLTextPlugin,Map:gn,NavigationControl:xn,GeolocateControl:Cn,AttributionControl:un,ScaleControl:Pn,FullscreenControl:Ln,Popup:Mn,Marker:Sn,Style:Ve,LngLat:U,LngLatBounds:N,Point:t.Point,Evented:t.Evented,config:u,get accessToken(){return u.ACCESS_TOKEN},set accessToken(t){u.ACCESS_TOKEN=t;},get workerCount(){return Vt.workerCount},set workerCount(t){Vt.workerCount=t;},workerUrl:""};return kn});

//

return mapboxgl;

})));


},{}],10:[function(require,module,exports){
'use strict';

// install ES6 Promise polyfill
require('./promise');

var interceptor = require('rest/interceptor');

var callbackify = interceptor({
  success: function (response) {
    var callback = response && response.callback;

    if (typeof callback === 'function') {
      callback(null, response.entity, response);
    }

    return response;
  },
  error: function (response) {
    var callback = response && response.callback;

    if (typeof callback === 'function') {
      var err = response.error || response.entity;
      if (typeof err !== 'object') err = new Error(err);
      callback(err);
    }

    return response;
  }
});

module.exports = callbackify;

},{"./promise":16,"rest/interceptor":30}],11:[function(require,module,exports){
'use strict';

// install ES6 Promise polyfill
require('./promise');

var rest = require('rest');

// rest.js client with MIME support
module.exports = function(config) {
  return rest
    .wrap(require('rest/interceptor/errorCode'))
    .wrap(require('rest/interceptor/pathPrefix'), { prefix: config.endpoint })
    .wrap(require('rest/interceptor/mime'), { mime: 'application/json' })
    .wrap(require('rest/interceptor/template'))
    .wrap(require('rest/interceptor/defaultRequest'), {
      params: { access_token: config.accessToken }
    })
    .wrap(require('./paginator'), { access_token: config.accessToken })
    .wrap(require('./standard_response'))
    .wrap(require('./callbackify'));
};

},{"./callbackify":10,"./paginator":15,"./promise":16,"./standard_response":18,"rest":26,"rest/interceptor/defaultRequest":31,"rest/interceptor/errorCode":32,"rest/interceptor/mime":33,"rest/interceptor/pathPrefix":34,"rest/interceptor/template":35}],12:[function(require,module,exports){

module.exports.DEFAULT_ENDPOINT = 'https://api.mapbox.com';

},{}],13:[function(require,module,exports){
'use strict';

var b64 = require('rest/util/base64');

/**
 * Access tokens actually are data, and using them we can derive
 * a user's username. This method attempts to do just that,
 * decoding the part of the token after the first `.` into
 * a username.
 *
 * @private
 * @param {string} token an access token
 * @return {string} username
 */
function getUser(token) {
  var data = token.split('.')[1];
  if (!data) return null;
  data = data.replace(/-/g, '+').replace(/_/g, '/');

  var mod = data.length % 4;
  if (mod === 2) data += '==';
  if (mod === 3) data += '=';
  if (mod === 1 || mod > 3) return null;

  try {
    return JSON.parse(b64.decode(data)).u;
  } catch(err) {
    return null;
  }
}

module.exports = getUser;

},{"rest/util/base64":45}],14:[function(require,module,exports){
'use strict';

var invariant = require('../vendor/invariant');
var constants = require('./constants');
var client = require('./client');
var getUser = require('./get_user');

/**
 * Services all have the same constructor pattern: you initialize them
 * with an access token and options, and they validate those arguments
 * in a predictable way. This is a constructor-generator that makes
 * it possible to require each service's API individually.
 *
 * @private
 * @param {string} name the name of the Mapbox API this class will access:
 * this is set to the name of the function so it will show up in tracebacks
 * @returns {Function} constructor function
 */
function makeService(name) {

  function service(accessToken, options) {
    this.name = name;

    invariant(typeof accessToken === 'string',
      'accessToken required to instantiate Mapbox client');

    var endpoint = constants.DEFAULT_ENDPOINT;

    if (options !== undefined) {
      invariant(typeof options === 'object', 'options must be an object');
      if (options.endpoint) {
        invariant(typeof options.endpoint === 'string', 'endpoint must be a string');
        endpoint = options.endpoint;
      }
      if (options.account) {
        invariant(typeof options.account === 'string', 'account must be a string');
        this.owner = options.account;
      }
    }

    this.client = client({
      endpoint: endpoint,
      accessToken: accessToken
    });

    this.accessToken = accessToken;
    this.endpoint = endpoint;
    this.owner = this.owner || getUser(accessToken);
    invariant(!!this.owner, 'could not determine account from provided accessToken');

  }

  return service;
}

module.exports = makeService;

},{"../vendor/invariant":19,"./client":11,"./constants":12,"./get_user":13}],15:[function(require,module,exports){
'use strict';

// install ES6 Promise polyfill
require('./promise');

var interceptor = require('rest/interceptor');
var linkParser = require('rest/parsers/rfc5988');
var url = require('url');
var querystring = require('querystring');

var paginator = interceptor({
  success: function (response, config) {
    var link = response && response.headers && response.headers.Link;
    var client = response && response.request && response.request.originator;

    if (link) {
      var nextLink = linkParser.parse(link).filter(function (link) {
        return link.rel === 'next';
      })[0];

      if (nextLink) {
        response.nextPage = function (callback) {
          var linkParts = url.parse(nextLink.href);
          var linkQuery = querystring.parse(linkParts.query);
          linkQuery.access_token = linkQuery.access_token || config.access_token;
          linkParts.search = querystring.stringify(linkQuery);
          return client({
            path: url.format(linkParts),
            callback: callback
          });
        };
      }
    }

    return response;
  }
});

module.exports = paginator;

},{"./promise":16,"querystring":24,"rest/interceptor":30,"rest/parsers/rfc5988":43,"url":56}],16:[function(require,module,exports){
'use strict';

// Installs ES6 Promise polyfill if a native Promise is not available

if (typeof Promise === 'undefined') {
  require('es6-promise').polyfill();
}

module.export = Promise;

},{"es6-promise":5}],17:[function(require,module,exports){
'use strict';

var invariant = require('../../vendor/invariant');
var makeService = require('../make_service');

var MapboxGeocoding = makeService('MapboxGeocoding');

var API_GEOCODING_FORWARD = '/geocoding/v5/{dataset}/{query}.json{?access_token,proximity,country,types,bbox,limit,autocomplete,language}';
var API_GEOCODING_REVERSE = '/geocoding/v5/{dataset}/{longitude},{latitude}.json{?access_token,types,limit,language}';

var REVERSE_GEOCODING_PRECISION = 5;
var FORWARD_GEOCODING_PROXIMITY_PRECISION = 3;

function roundTo(value, places) {
  var mult = Math.pow(10, places);
  return Math.round(value * mult) / mult;
}

/**
 * Search for a location with a string, using the
 * [Mapbox Geocoding API](https://www.mapbox.com/api-documentation/#geocoding).
 *
 * The `query` parmeter can be an array of strings only if batch geocoding
 * is used by specifying `mapbox.places-permanent` as the `dataset` option.
 *
 * @param {string|Array<string>} query desired location
 * @param {Object} [options={}] additional options meant to tune
 * the request
 * @param {Object} options.proximity a proximity argument: this is
 * a geographical point given as an object with latitude and longitude
 * properties. Search results closer to this point will be given
 * higher priority.
 * @param {Array} options.bbox a bounding box argument: this is
 * a bounding box given as an array in the format [minX, minY, maxX, maxY].
 * Search results will be limited to the bounding box.
 * @param {string} options.language Specify the language to use for response text and, for forward geocoding, query result weighting. Options are IETF language tags comprised of a mandatory ISO 639-1 language code and optionally one or more IETF subtags for country or script. More than one value can also be specified, separated by commas. 
 * @param {string} options.types a comma seperated list of types that filter
 * results to match those specified. See https://www.mapbox.com/developers/api/geocoding/#filter-type
 * for available types.
 * @param {number} [options.limit=5] is the maximum number of results to return, between 1 and 10 inclusive.
 * Some very specific queries may return fewer results than the limit.
 * @param {string} options.country a comma separated list of country codes to
 * limit results to specified country or countries.
 * @param {boolean} [options.autocomplete=true] whether to include results that include
 * the query only as a prefix. This is useful for UIs where users type
 * values, but if you have complete addresses as input, you'll want to turn it off
 * @param {string} [options.dataset=mapbox.places] the desired data to be
 * geocoded against. The default, mapbox.places, does not permit unlimited
 * caching. `mapbox.places-permanent` is available on request and does
 * permit permanent caching.
 * @param {Function} callback called with (err, results)
 * @returns {Promise} response
 * @memberof MapboxClient
 * @example
 * var mapboxClient = new MapboxClient('ACCESSTOKEN');
 * mapboxClient.geocodeForward('Paris, France', function(err, res) {
 *   // res is a GeoJSON document with geocoding matches
 * });
 * // using the proximity option to weight results closer to texas
 * mapboxClient.geocodeForward('Paris, France', {
 *   proximity: { latitude: 33.6875431, longitude: -95.4431142 }
 * }, function(err, res) {
 *   // res is a GeoJSON document with geocoding matches
 * });
 * // using the bbox option to limit results to a portion of Washington, D.C.
 * mapboxClient.geocodeForward('Starbucks', {
 *   bbox: [-77.083056,38.908611,-76.997778,38.959167]
 * }, function(err, res) {
 *   // res is a GeoJSON document with geocoding matches
 * });
 */
MapboxGeocoding.prototype.geocodeForward = function(query, options, callback) {

  // permit the options argument to be omitted
  if (callback === undefined && typeof options === 'function') {
    callback = options;
    options = {};
  }

  // typecheck arguments
  if (Array.isArray(query)) {
    if (options.dataset !== 'mapbox.places-permanent') {
      throw new Error('Batch geocoding is only available with the mapbox.places-permanent endpoint. See https://mapbox.com/api-documentation/#batch-requests for details');
    } else {
      query = query.join(';');
    }
  }
  invariant(typeof query === 'string', 'query must be a string');
  invariant(typeof options === 'object', 'options must be an object');

  var queryOptions = {
    query: query,
    dataset: 'mapbox.places'
  };

  var precision = FORWARD_GEOCODING_PROXIMITY_PRECISION;
  if (options.precision) {
    invariant(typeof options.precision === 'number', 'precision option must be number');
    precision = options.precision;
  }

  if (options.proximity) {
    invariant(typeof options.proximity.latitude === 'number' &&
      typeof options.proximity.longitude === 'number',
      'proximity must be an object with numeric latitude & longitude properties');
    queryOptions.proximity = roundTo(options.proximity.longitude, precision) + ',' + roundTo(options.proximity.latitude, precision);
  }

  if (options.bbox) {
    invariant(typeof options.bbox[0] === 'number' &&
      typeof options.bbox[1] === 'number' &&
      typeof options.bbox[2] === 'number' &&
      typeof options.bbox[3] === 'number' &&
      options.bbox.length === 4,
      'bbox must be an array with numeric values in the form [minX, minY, maxX, maxY]');
    queryOptions.bbox = options.bbox[0] + ',' + options.bbox[1] + ',' + options.bbox[2] + ',' + options.bbox[3];
  }

  if (options.limit) {
    invariant(typeof options.limit === 'number',
      'limit must be a number');
    queryOptions.limit = options.limit;
  }

  if (options.dataset) {
    invariant(typeof options.dataset === 'string', 'dataset option must be string');
    queryOptions.dataset = options.dataset;
  }

  if (options.country) {
    invariant(typeof options.country === 'string', 'country option must be string');
    queryOptions.country = options.country;
  }

  if (options.language) {
    invariant(typeof options.language === 'string', 'language option must be string');
    queryOptions.language = options.language;
  }

  if (options.types) {
    invariant(typeof options.types === 'string', 'types option must be string');
    queryOptions.types = options.types;
  }

  if (typeof options.autocomplete === 'boolean') {
    invariant(typeof options.autocomplete === 'boolean', 'autocomplete must be a boolean');
    queryOptions.autocomplete = options.autocomplete;
  }

  return this.client({
    path: API_GEOCODING_FORWARD,
    params: queryOptions,
    callback: callback
  });
};

/**
 * Given a location, determine what geographical features are located
 * there. This uses the [Mapbox Geocoding API](https://www.mapbox.com/api-documentation/#geocoding).
 *
 * @param {Object} location the geographical point to search
 * @param {number} location.latitude decimal degrees latitude, in range -90 to 90
 * @param {number} location.longitude decimal degrees longitude, in range -180 to 180
 * @param {Object} [options={}] additional options meant to tune
 * the request.
 * @param {string} options.language Specify the language to use for response text and, for forward geocoding, query result weighting. Options are IETF language tags comprised of a mandatory ISO 639-1 language code and optionally one or more IETF subtags for country or script. More than one value can also be specified, separated by commas.
 * @param {string} options.types a comma seperated list of types that filter
 * results to match those specified. See
 * https://www.mapbox.com/api-documentation/#retrieve-places-near-a-location
 * for available types.
 * @param {number} [options.limit=1] is the maximum number of results to return, between 1 and 5
 * inclusive. Requires a single options.types to be specified (see example).
 * @param {string} [options.dataset=mapbox.places] the desired data to be
 * geocoded against. The default, mapbox.places, does not permit unlimited
 * caching. `mapbox.places-permanent` is available on request and does
 * permit permanent caching.
 * @param {Function} callback called with (err, results)
 * @returns {Promise} response
 * @example
 * var mapboxClient = new MapboxGeocoding('ACCESSTOKEN');
 * mapboxClient.geocodeReverse(
 *   { latitude: 33.6875431, longitude: -95.4431142 },
 *   function(err, res) {
 *   // res is a GeoJSON document with geocoding matches
 * });
 * @example
 * var mapboxClient = new MapboxGeocoding('ACCESSTOKEN');
 * mapboxClient.geocodeReverse(
 *   { latitude: 33.6875431, longitude: -95.4431142, options: { types: address, limit: 3 } },
 *   function(err, res) {
 *   // res is a GeoJSON document with up to 3 geocoding matches
 * });
 */
MapboxGeocoding.prototype.geocodeReverse = function(location, options, callback) {

  // permit the options argument to be omitted
  if (callback === undefined && typeof options === 'function') {
    callback = options;
    options = {};
  }

  // typecheck arguments
  invariant(typeof location === 'object', 'location must be an object');
  invariant(typeof options === 'object', 'options must be an object');

  invariant(typeof location.latitude === 'number' &&
    typeof location.longitude === 'number',
    'location must be an object with numeric latitude & longitude properties');

  var queryOptions = {
    dataset: 'mapbox.places'
  };

  if (options.dataset) {
    invariant(typeof options.dataset === 'string', 'dataset option must be string');
    queryOptions.dataset = options.dataset;
  }

  var precision = REVERSE_GEOCODING_PRECISION;
  if (options.precision) {
    invariant(typeof options.precision === 'number', 'precision option must be number');
    precision = options.precision;
  }

  if (options.language) {
    invariant(typeof options.language === 'string', 'language option must be string');
    queryOptions.language = options.language;
  }

  if (options.types) {
    invariant(typeof options.types === 'string', 'types option must be string');
    queryOptions.types = options.types;
  }

  if (options.limit) {
    invariant(typeof options.limit === 'number', 'limit option must be a number');
    invariant(options.types.split(',').length === 1, 'a single type must be specified to use the limit option');
    queryOptions.limit = options.limit;
  }

  queryOptions.longitude = roundTo(location.longitude, precision);
  queryOptions.latitude = roundTo(location.latitude, precision);

  return this.client({
    path: API_GEOCODING_REVERSE,
    params: queryOptions,
    callback: callback
  });
};

module.exports = MapboxGeocoding;

},{"../../vendor/invariant":19,"../make_service":14}],18:[function(require,module,exports){
var interceptor = require('rest/interceptor');

var standardResponse = interceptor({
  response: transform,
});

function transform(response) {
  return {
    url: response.url,
    status: response.status && response.status.code,
    headers: response.headers,
    entity: response.entity,
    error: response.error,
    callback: response.request && response.request.callback,
    nextPage: response.nextPage
  };
}

module.exports = standardResponse;

},{"rest/interceptor":30}],19:[function(require,module,exports){
(function (process){
/*
 * Copyright 2013-2015, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

'use strict';

/*
 * Use invariant() to assert state which your program assumes to be true.
 *
 * Provide sprintf-style format (only %s is supported) and arguments
 * to provide information about what broke and what you were
 * expecting.
 *
 * The invariant message will be stripped in production, but the invariant
 * will remain to ensure logic does not differ in production.
 */

var NODE_ENV = process.env.NODE_ENV;

var invariant = function(condition, format, a, b, c, d, e, f) {
  if (NODE_ENV !== 'production') {
    if (format === undefined) {
      throw new Error('invariant requires an error message argument');
    }
  }

  if (!condition) {
    var error;
    if (format === undefined) {
      error = new Error(
        'Minified exception occurred; use the non-minified dev environment ' +
        'for the full error message and additional helpful warnings.'
      );
    } else {
      var args = [a, b, c, d, e, f];
      var argIndex = 0;
      error = new Error(
        format.replace(/%s/g, function() { return args[argIndex++]; })
      );
      error.name = 'Invariant Violation';
    }

    error.framesToPop = 1; // we don't care about invariant's own frame
    throw error;
  }
};

module.exports = invariant;

}).call(this,require('_process'))
},{"_process":20}],20:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],21:[function(require,module,exports){
(function (global){
/*! https://mths.be/punycode v1.4.1 by @mathias */
;(function(root) {

	/** Detect free variables */
	var freeExports = typeof exports == 'object' && exports &&
		!exports.nodeType && exports;
	var freeModule = typeof module == 'object' && module &&
		!module.nodeType && module;
	var freeGlobal = typeof global == 'object' && global;
	if (
		freeGlobal.global === freeGlobal ||
		freeGlobal.window === freeGlobal ||
		freeGlobal.self === freeGlobal
	) {
		root = freeGlobal;
	}

	/**
	 * The `punycode` object.
	 * @name punycode
	 * @type Object
	 */
	var punycode,

	/** Highest positive signed 32-bit float value */
	maxInt = 2147483647, // aka. 0x7FFFFFFF or 2^31-1

	/** Bootstring parameters */
	base = 36,
	tMin = 1,
	tMax = 26,
	skew = 38,
	damp = 700,
	initialBias = 72,
	initialN = 128, // 0x80
	delimiter = '-', // '\x2D'

	/** Regular expressions */
	regexPunycode = /^xn--/,
	regexNonASCII = /[^\x20-\x7E]/, // unprintable ASCII chars + non-ASCII chars
	regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g, // RFC 3490 separators

	/** Error messages */
	errors = {
		'overflow': 'Overflow: input needs wider integers to process',
		'not-basic': 'Illegal input >= 0x80 (not a basic code point)',
		'invalid-input': 'Invalid input'
	},

	/** Convenience shortcuts */
	baseMinusTMin = base - tMin,
	floor = Math.floor,
	stringFromCharCode = String.fromCharCode,

	/** Temporary variable */
	key;

	/*--------------------------------------------------------------------------*/

	/**
	 * A generic error utility function.
	 * @private
	 * @param {String} type The error type.
	 * @returns {Error} Throws a `RangeError` with the applicable error message.
	 */
	function error(type) {
		throw new RangeError(errors[type]);
	}

	/**
	 * A generic `Array#map` utility function.
	 * @private
	 * @param {Array} array The array to iterate over.
	 * @param {Function} callback The function that gets called for every array
	 * item.
	 * @returns {Array} A new array of values returned by the callback function.
	 */
	function map(array, fn) {
		var length = array.length;
		var result = [];
		while (length--) {
			result[length] = fn(array[length]);
		}
		return result;
	}

	/**
	 * A simple `Array#map`-like wrapper to work with domain name strings or email
	 * addresses.
	 * @private
	 * @param {String} domain The domain name or email address.
	 * @param {Function} callback The function that gets called for every
	 * character.
	 * @returns {Array} A new string of characters returned by the callback
	 * function.
	 */
	function mapDomain(string, fn) {
		var parts = string.split('@');
		var result = '';
		if (parts.length > 1) {
			// In email addresses, only the domain name should be punycoded. Leave
			// the local part (i.e. everything up to `@`) intact.
			result = parts[0] + '@';
			string = parts[1];
		}
		// Avoid `split(regex)` for IE8 compatibility. See #17.
		string = string.replace(regexSeparators, '\x2E');
		var labels = string.split('.');
		var encoded = map(labels, fn).join('.');
		return result + encoded;
	}

	/**
	 * Creates an array containing the numeric code points of each Unicode
	 * character in the string. While JavaScript uses UCS-2 internally,
	 * this function will convert a pair of surrogate halves (each of which
	 * UCS-2 exposes as separate characters) into a single code point,
	 * matching UTF-16.
	 * @see `punycode.ucs2.encode`
	 * @see <https://mathiasbynens.be/notes/javascript-encoding>
	 * @memberOf punycode.ucs2
	 * @name decode
	 * @param {String} string The Unicode input string (UCS-2).
	 * @returns {Array} The new array of code points.
	 */
	function ucs2decode(string) {
		var output = [],
		    counter = 0,
		    length = string.length,
		    value,
		    extra;
		while (counter < length) {
			value = string.charCodeAt(counter++);
			if (value >= 0xD800 && value <= 0xDBFF && counter < length) {
				// high surrogate, and there is a next character
				extra = string.charCodeAt(counter++);
				if ((extra & 0xFC00) == 0xDC00) { // low surrogate
					output.push(((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000);
				} else {
					// unmatched surrogate; only append this code unit, in case the next
					// code unit is the high surrogate of a surrogate pair
					output.push(value);
					counter--;
				}
			} else {
				output.push(value);
			}
		}
		return output;
	}

	/**
	 * Creates a string based on an array of numeric code points.
	 * @see `punycode.ucs2.decode`
	 * @memberOf punycode.ucs2
	 * @name encode
	 * @param {Array} codePoints The array of numeric code points.
	 * @returns {String} The new Unicode string (UCS-2).
	 */
	function ucs2encode(array) {
		return map(array, function(value) {
			var output = '';
			if (value > 0xFFFF) {
				value -= 0x10000;
				output += stringFromCharCode(value >>> 10 & 0x3FF | 0xD800);
				value = 0xDC00 | value & 0x3FF;
			}
			output += stringFromCharCode(value);
			return output;
		}).join('');
	}

	/**
	 * Converts a basic code point into a digit/integer.
	 * @see `digitToBasic()`
	 * @private
	 * @param {Number} codePoint The basic numeric code point value.
	 * @returns {Number} The numeric value of a basic code point (for use in
	 * representing integers) in the range `0` to `base - 1`, or `base` if
	 * the code point does not represent a value.
	 */
	function basicToDigit(codePoint) {
		if (codePoint - 48 < 10) {
			return codePoint - 22;
		}
		if (codePoint - 65 < 26) {
			return codePoint - 65;
		}
		if (codePoint - 97 < 26) {
			return codePoint - 97;
		}
		return base;
	}

	/**
	 * Converts a digit/integer into a basic code point.
	 * @see `basicToDigit()`
	 * @private
	 * @param {Number} digit The numeric value of a basic code point.
	 * @returns {Number} The basic code point whose value (when used for
	 * representing integers) is `digit`, which needs to be in the range
	 * `0` to `base - 1`. If `flag` is non-zero, the uppercase form is
	 * used; else, the lowercase form is used. The behavior is undefined
	 * if `flag` is non-zero and `digit` has no uppercase form.
	 */
	function digitToBasic(digit, flag) {
		//  0..25 map to ASCII a..z or A..Z
		// 26..35 map to ASCII 0..9
		return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);
	}

	/**
	 * Bias adaptation function as per section 3.4 of RFC 3492.
	 * https://tools.ietf.org/html/rfc3492#section-3.4
	 * @private
	 */
	function adapt(delta, numPoints, firstTime) {
		var k = 0;
		delta = firstTime ? floor(delta / damp) : delta >> 1;
		delta += floor(delta / numPoints);
		for (/* no initialization */; delta > baseMinusTMin * tMax >> 1; k += base) {
			delta = floor(delta / baseMinusTMin);
		}
		return floor(k + (baseMinusTMin + 1) * delta / (delta + skew));
	}

	/**
	 * Converts a Punycode string of ASCII-only symbols to a string of Unicode
	 * symbols.
	 * @memberOf punycode
	 * @param {String} input The Punycode string of ASCII-only symbols.
	 * @returns {String} The resulting string of Unicode symbols.
	 */
	function decode(input) {
		// Don't use UCS-2
		var output = [],
		    inputLength = input.length,
		    out,
		    i = 0,
		    n = initialN,
		    bias = initialBias,
		    basic,
		    j,
		    index,
		    oldi,
		    w,
		    k,
		    digit,
		    t,
		    /** Cached calculation results */
		    baseMinusT;

		// Handle the basic code points: let `basic` be the number of input code
		// points before the last delimiter, or `0` if there is none, then copy
		// the first basic code points to the output.

		basic = input.lastIndexOf(delimiter);
		if (basic < 0) {
			basic = 0;
		}

		for (j = 0; j < basic; ++j) {
			// if it's not a basic code point
			if (input.charCodeAt(j) >= 0x80) {
				error('not-basic');
			}
			output.push(input.charCodeAt(j));
		}

		// Main decoding loop: start just after the last delimiter if any basic code
		// points were copied; start at the beginning otherwise.

		for (index = basic > 0 ? basic + 1 : 0; index < inputLength; /* no final expression */) {

			// `index` is the index of the next character to be consumed.
			// Decode a generalized variable-length integer into `delta`,
			// which gets added to `i`. The overflow checking is easier
			// if we increase `i` as we go, then subtract off its starting
			// value at the end to obtain `delta`.
			for (oldi = i, w = 1, k = base; /* no condition */; k += base) {

				if (index >= inputLength) {
					error('invalid-input');
				}

				digit = basicToDigit(input.charCodeAt(index++));

				if (digit >= base || digit > floor((maxInt - i) / w)) {
					error('overflow');
				}

				i += digit * w;
				t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);

				if (digit < t) {
					break;
				}

				baseMinusT = base - t;
				if (w > floor(maxInt / baseMinusT)) {
					error('overflow');
				}

				w *= baseMinusT;

			}

			out = output.length + 1;
			bias = adapt(i - oldi, out, oldi == 0);

			// `i` was supposed to wrap around from `out` to `0`,
			// incrementing `n` each time, so we'll fix that now:
			if (floor(i / out) > maxInt - n) {
				error('overflow');
			}

			n += floor(i / out);
			i %= out;

			// Insert `n` at position `i` of the output
			output.splice(i++, 0, n);

		}

		return ucs2encode(output);
	}

	/**
	 * Converts a string of Unicode symbols (e.g. a domain name label) to a
	 * Punycode string of ASCII-only symbols.
	 * @memberOf punycode
	 * @param {String} input The string of Unicode symbols.
	 * @returns {String} The resulting Punycode string of ASCII-only symbols.
	 */
	function encode(input) {
		var n,
		    delta,
		    handledCPCount,
		    basicLength,
		    bias,
		    j,
		    m,
		    q,
		    k,
		    t,
		    currentValue,
		    output = [],
		    /** `inputLength` will hold the number of code points in `input`. */
		    inputLength,
		    /** Cached calculation results */
		    handledCPCountPlusOne,
		    baseMinusT,
		    qMinusT;

		// Convert the input in UCS-2 to Unicode
		input = ucs2decode(input);

		// Cache the length
		inputLength = input.length;

		// Initialize the state
		n = initialN;
		delta = 0;
		bias = initialBias;

		// Handle the basic code points
		for (j = 0; j < inputLength; ++j) {
			currentValue = input[j];
			if (currentValue < 0x80) {
				output.push(stringFromCharCode(currentValue));
			}
		}

		handledCPCount = basicLength = output.length;

		// `handledCPCount` is the number of code points that have been handled;
		// `basicLength` is the number of basic code points.

		// Finish the basic string - if it is not empty - with a delimiter
		if (basicLength) {
			output.push(delimiter);
		}

		// Main encoding loop:
		while (handledCPCount < inputLength) {

			// All non-basic code points < n have been handled already. Find the next
			// larger one:
			for (m = maxInt, j = 0; j < inputLength; ++j) {
				currentValue = input[j];
				if (currentValue >= n && currentValue < m) {
					m = currentValue;
				}
			}

			// Increase `delta` enough to advance the decoder's <n,i> state to <m,0>,
			// but guard against overflow
			handledCPCountPlusOne = handledCPCount + 1;
			if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
				error('overflow');
			}

			delta += (m - n) * handledCPCountPlusOne;
			n = m;

			for (j = 0; j < inputLength; ++j) {
				currentValue = input[j];

				if (currentValue < n && ++delta > maxInt) {
					error('overflow');
				}

				if (currentValue == n) {
					// Represent delta as a generalized variable-length integer
					for (q = delta, k = base; /* no condition */; k += base) {
						t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
						if (q < t) {
							break;
						}
						qMinusT = q - t;
						baseMinusT = base - t;
						output.push(
							stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0))
						);
						q = floor(qMinusT / baseMinusT);
					}

					output.push(stringFromCharCode(digitToBasic(q, 0)));
					bias = adapt(delta, handledCPCountPlusOne, handledCPCount == basicLength);
					delta = 0;
					++handledCPCount;
				}
			}

			++delta;
			++n;

		}
		return output.join('');
	}

	/**
	 * Converts a Punycode string representing a domain name or an email address
	 * to Unicode. Only the Punycoded parts of the input will be converted, i.e.
	 * it doesn't matter if you call it on a string that has already been
	 * converted to Unicode.
	 * @memberOf punycode
	 * @param {String} input The Punycoded domain name or email address to
	 * convert to Unicode.
	 * @returns {String} The Unicode representation of the given Punycode
	 * string.
	 */
	function toUnicode(input) {
		return mapDomain(input, function(string) {
			return regexPunycode.test(string)
				? decode(string.slice(4).toLowerCase())
				: string;
		});
	}

	/**
	 * Converts a Unicode string representing a domain name or an email address to
	 * Punycode. Only the non-ASCII parts of the domain name will be converted,
	 * i.e. it doesn't matter if you call it with a domain that's already in
	 * ASCII.
	 * @memberOf punycode
	 * @param {String} input The domain name or email address to convert, as a
	 * Unicode string.
	 * @returns {String} The Punycode representation of the given domain name or
	 * email address.
	 */
	function toASCII(input) {
		return mapDomain(input, function(string) {
			return regexNonASCII.test(string)
				? 'xn--' + encode(string)
				: string;
		});
	}

	/*--------------------------------------------------------------------------*/

	/** Define the public API */
	punycode = {
		/**
		 * A string representing the current Punycode.js version number.
		 * @memberOf punycode
		 * @type String
		 */
		'version': '1.4.1',
		/**
		 * An object of methods to convert from JavaScript's internal character
		 * representation (UCS-2) to Unicode code points, and back.
		 * @see <https://mathiasbynens.be/notes/javascript-encoding>
		 * @memberOf punycode
		 * @type Object
		 */
		'ucs2': {
			'decode': ucs2decode,
			'encode': ucs2encode
		},
		'decode': decode,
		'encode': encode,
		'toASCII': toASCII,
		'toUnicode': toUnicode
	};

	/** Expose `punycode` */
	// Some AMD build optimizers, like r.js, check for specific condition patterns
	// like the following:
	if (
		typeof define == 'function' &&
		typeof define.amd == 'object' &&
		define.amd
	) {
		define('punycode', function() {
			return punycode;
		});
	} else if (freeExports && freeModule) {
		if (module.exports == freeExports) {
			// in Node.js, io.js, or RingoJS v0.8.0+
			freeModule.exports = punycode;
		} else {
			// in Narwhal or RingoJS v0.7.0-
			for (key in punycode) {
				punycode.hasOwnProperty(key) && (freeExports[key] = punycode[key]);
			}
		}
	} else {
		// in Rhino or a web browser
		root.punycode = punycode;
	}

}(this));

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],22:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

// If obj.hasOwnProperty has been overridden, then calling
// obj.hasOwnProperty(prop) will break.
// See: https://github.com/joyent/node/issues/1707
function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

module.exports = function(qs, sep, eq, options) {
  sep = sep || '&';
  eq = eq || '=';
  var obj = {};

  if (typeof qs !== 'string' || qs.length === 0) {
    return obj;
  }

  var regexp = /\+/g;
  qs = qs.split(sep);

  var maxKeys = 1000;
  if (options && typeof options.maxKeys === 'number') {
    maxKeys = options.maxKeys;
  }

  var len = qs.length;
  // maxKeys <= 0 means that we should not limit keys count
  if (maxKeys > 0 && len > maxKeys) {
    len = maxKeys;
  }

  for (var i = 0; i < len; ++i) {
    var x = qs[i].replace(regexp, '%20'),
        idx = x.indexOf(eq),
        kstr, vstr, k, v;

    if (idx >= 0) {
      kstr = x.substr(0, idx);
      vstr = x.substr(idx + 1);
    } else {
      kstr = x;
      vstr = '';
    }

    k = decodeURIComponent(kstr);
    v = decodeURIComponent(vstr);

    if (!hasOwnProperty(obj, k)) {
      obj[k] = v;
    } else if (isArray(obj[k])) {
      obj[k].push(v);
    } else {
      obj[k] = [obj[k], v];
    }
  }

  return obj;
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

},{}],23:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

var stringifyPrimitive = function(v) {
  switch (typeof v) {
    case 'string':
      return v;

    case 'boolean':
      return v ? 'true' : 'false';

    case 'number':
      return isFinite(v) ? v : '';

    default:
      return '';
  }
};

module.exports = function(obj, sep, eq, name) {
  sep = sep || '&';
  eq = eq || '=';
  if (obj === null) {
    obj = undefined;
  }

  if (typeof obj === 'object') {
    return map(objectKeys(obj), function(k) {
      var ks = encodeURIComponent(stringifyPrimitive(k)) + eq;
      if (isArray(obj[k])) {
        return map(obj[k], function(v) {
          return ks + encodeURIComponent(stringifyPrimitive(v));
        }).join(sep);
      } else {
        return ks + encodeURIComponent(stringifyPrimitive(obj[k]));
      }
    }).join(sep);

  }

  if (!name) return '';
  return encodeURIComponent(stringifyPrimitive(name)) + eq +
         encodeURIComponent(stringifyPrimitive(obj));
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

function map (xs, f) {
  if (xs.map) return xs.map(f);
  var res = [];
  for (var i = 0; i < xs.length; i++) {
    res.push(f(xs[i], i));
  }
  return res;
}

var objectKeys = Object.keys || function (obj) {
  var res = [];
  for (var key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) res.push(key);
  }
  return res;
};

},{}],24:[function(require,module,exports){
'use strict';

exports.decode = exports.parse = require('./decode');
exports.encode = exports.stringify = require('./encode');

},{"./decode":22,"./encode":23}],25:[function(require,module,exports){
/*
 * Copyright 2012-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

var mixin, xWWWFormURLEncoder, origin, urlRE, absoluteUrlRE, fullyQualifiedUrlRE;

mixin = require('./util/mixin');
xWWWFormURLEncoder = require('./mime/type/application/x-www-form-urlencoded');

urlRE = /([a-z][a-z0-9\+\-\.]*:)\/\/([^@]+@)?(([^:\/]+)(:([0-9]+))?)?(\/[^?#]*)?(\?[^#]*)?(#\S*)?/i;
absoluteUrlRE = /^([a-z][a-z0-9\-\+\.]*:\/\/|\/)/i;
fullyQualifiedUrlRE = /([a-z][a-z0-9\+\-\.]*:)\/\/([^@]+@)?(([^:\/]+)(:([0-9]+))?)?\//i;

/**
 * Apply params to the template to create a URL.
 *
 * Parameters that are not applied directly to the template, are appended
 * to the URL as query string parameters.
 *
 * @param {string} template the URI template
 * @param {Object} params parameters to apply to the template
 * @return {string} the resulting URL
 */
function buildUrl(template, params) {
	// internal builder to convert template with params.
	var url, name, queryStringParams, queryString, re;

	url = template;
	queryStringParams = {};

	if (params) {
		for (name in params) {
			/*jshint forin:false */
			re = new RegExp('\\{' + name + '\\}');
			if (re.test(url)) {
				url = url.replace(re, encodeURIComponent(params[name]), 'g');
			}
			else {
				queryStringParams[name] = params[name];
			}
		}

		queryString = xWWWFormURLEncoder.write(queryStringParams);
		if (queryString) {
			url += url.indexOf('?') === -1 ? '?' : '&';
			url += queryString;
		}
	}
	return url;
}

function startsWith(str, test) {
	return str.indexOf(test) === 0;
}

/**
 * Create a new URL Builder
 *
 * @param {string|UrlBuilder} template the base template to build from, may be another UrlBuilder
 * @param {Object} [params] base parameters
 * @constructor
 */
function UrlBuilder(template, params) {
	if (!(this instanceof UrlBuilder)) {
		// invoke as a constructor
		return new UrlBuilder(template, params);
	}

	if (template instanceof UrlBuilder) {
		this._template = template.template;
		this._params = mixin({}, this._params, params);
	}
	else {
		this._template = (template || '').toString();
		this._params = params || {};
	}
}

UrlBuilder.prototype = {

	/**
	 * Create a new UrlBuilder instance that extends the current builder.
	 * The current builder is unmodified.
	 *
	 * @param {string} [template] URL template to append to the current template
	 * @param {Object} [params] params to combine with current params.  New params override existing params
	 * @return {UrlBuilder} the new builder
	 */
	append: function (template,  params) {
		// TODO consider query strings and fragments
		return new UrlBuilder(this._template + template, mixin({}, this._params, params));
	},

	/**
	 * Create a new UrlBuilder with a fully qualified URL based on the
	 * window's location or base href and the current templates relative URL.
	 *
	 * Path variables are preserved.
	 *
	 * *Browser only*
	 *
	 * @return {UrlBuilder} the fully qualified URL template
	 */
	fullyQualify: function () {
		if (typeof location === 'undefined') { return this; }
		if (this.isFullyQualified()) { return this; }

		var template = this._template;

		if (startsWith(template, '//')) {
			template = origin.protocol + template;
		}
		else if (startsWith(template, '/')) {
			template = origin.origin + template;
		}
		else if (!this.isAbsolute()) {
			template = origin.origin + origin.pathname.substring(0, origin.pathname.lastIndexOf('/') + 1);
		}

		if (template.indexOf('/', 8) === -1) {
			// default the pathname to '/'
			template = template + '/';
		}

		return new UrlBuilder(template, this._params);
	},

	/**
	 * True if the URL is absolute
	 *
	 * @return {boolean}
	 */
	isAbsolute: function () {
		return absoluteUrlRE.test(this.build());
	},

	/**
	 * True if the URL is fully qualified
	 *
	 * @return {boolean}
	 */
	isFullyQualified: function () {
		return fullyQualifiedUrlRE.test(this.build());
	},

	/**
	 * True if the URL is cross origin. The protocol, host and port must not be
	 * the same in order to be cross origin,
	 *
	 * @return {boolean}
	 */
	isCrossOrigin: function () {
		if (!origin) {
			return true;
		}
		var url = this.parts();
		return url.protocol !== origin.protocol ||
		       url.hostname !== origin.hostname ||
		       url.port !== origin.port;
	},

	/**
	 * Split a URL into its consituent parts following the naming convention of
	 * 'window.location'. One difference is that the port will contain the
	 * protocol default if not specified.
	 *
	 * @see https://developer.mozilla.org/en-US/docs/DOM/window.location
	 *
	 * @returns {Object} a 'window.location'-like object
	 */
	parts: function () {
		/*jshint maxcomplexity:20 */
		var url, parts;
		url = this.fullyQualify().build().match(urlRE);
		parts = {
			href: url[0],
			protocol: url[1],
			host: url[3] || '',
			hostname: url[4] || '',
			port: url[6],
			pathname: url[7] || '',
			search: url[8] || '',
			hash: url[9] || ''
		};
		parts.origin = parts.protocol + '//' + parts.host;
		parts.port = parts.port || (parts.protocol === 'https:' ? '443' : parts.protocol === 'http:' ? '80' : '');
		return parts;
	},

	/**
	 * Expand the template replacing path variables with parameters
	 *
	 * @param {Object} [params] params to combine with current params.  New params override existing params
	 * @return {string} the expanded URL
	 */
	build: function (params) {
		return buildUrl(this._template, mixin({}, this._params, params));
	},

	/**
	 * @see build
	 */
	toString: function () {
		return this.build();
	}

};

origin = typeof location !== 'undefined' ? new UrlBuilder(location.href).parts() : void 0;

module.exports = UrlBuilder;

},{"./mime/type/application/x-www-form-urlencoded":40,"./util/mixin":48}],26:[function(require,module,exports){
/*
 * Copyright 2014-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

var rest = require('./client/default'),
    browser = require('./client/xhr');

rest.setPlatformDefaultClient(browser);

module.exports = rest;

},{"./client/default":28,"./client/xhr":29}],27:[function(require,module,exports){
/*
 * Copyright 2014-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

/**
 * Add common helper methods to a client impl
 *
 * @param {function} impl the client implementation
 * @param {Client} [target] target of this client, used when wrapping other clients
 * @returns {Client} the client impl with additional methods
 */
module.exports = function client(impl, target) {

	if (target) {

		/**
		 * @returns {Client} the target client
		 */
		impl.skip = function skip() {
			return target;
		};

	}

	/**
	 * Allow a client to easily be wrapped by an interceptor
	 *
	 * @param {Interceptor} interceptor the interceptor to wrap this client with
	 * @param [config] configuration for the interceptor
	 * @returns {Client} the newly wrapped client
	 */
	impl.wrap = function wrap(interceptor, config) {
		return interceptor(impl, config);
	};

	/**
	 * @deprecated
	 */
	impl.chain = function chain() {
		if (typeof console !== 'undefined') {
			console.log('rest.js: client.chain() is deprecated, use client.wrap() instead');
		}

		return impl.wrap.apply(this, arguments);
	};

	return impl;

};

},{}],28:[function(require,module,exports){
/*
 * Copyright 2014-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

/**
 * Plain JS Object containing properties that represent an HTTP request.
 *
 * Depending on the capabilities of the underlying client, a request
 * may be cancelable. If a request may be canceled, the client will add
 * a canceled flag and cancel function to the request object. Canceling
 * the request will put the response into an error state.
 *
 * @field {string} [method='GET'] HTTP method, commonly GET, POST, PUT, DELETE or HEAD
 * @field {string|UrlBuilder} [path=''] path template with optional path variables
 * @field {Object} [params] parameters for the path template and query string
 * @field {Object} [headers] custom HTTP headers to send, in addition to the clients default headers
 * @field [entity] the HTTP entity, common for POST or PUT requests
 * @field {boolean} [canceled] true if the request has been canceled, set by the client
 * @field {Function} [cancel] cancels the request if invoked, provided by the client
 * @field {Client} [originator] the client that first handled this request, provided by the interceptor
 *
 * @class Request
 */

/**
 * Plain JS Object containing properties that represent an HTTP response
 *
 * @field {Object} [request] the request object as received by the root client
 * @field {Object} [raw] the underlying request object, like XmlHttpRequest in a browser
 * @field {number} [status.code] status code of the response (i.e. 200, 404)
 * @field {string} [status.text] status phrase of the response
 * @field {Object] [headers] response headers hash of normalized name, value pairs
 * @field [entity] the response body
 *
 * @class Response
 */

/**
 * HTTP client particularly suited for RESTful operations.
 *
 * @field {function} wrap wraps this client with a new interceptor returning the wrapped client
 *
 * @param {Request} the HTTP request
 * @returns {ResponsePromise<Response>} a promise the resolves to the HTTP response
 *
 * @class Client
 */

 /**
  * Extended when.js Promises/A+ promise with HTTP specific helpers
  *q
  * @method entity promise for the HTTP entity
  * @method status promise for the HTTP status code
  * @method headers promise for the HTTP response headers
  * @method header promise for a specific HTTP response header
  *
  * @class ResponsePromise
  * @extends Promise
  */

var client, target, platformDefault;

client = require('../client');

if (typeof Promise !== 'function' && console && console.log) {
	console.log('An ES6 Promise implementation is required to use rest.js. See https://github.com/cujojs/when/blob/master/docs/es6-promise-shim.md for using when.js as a Promise polyfill.');
}

/**
 * Make a request with the default client
 * @param {Request} the HTTP request
 * @returns {Promise<Response>} a promise the resolves to the HTTP response
 */
function defaultClient() {
	return target.apply(void 0, arguments);
}

/**
 * Change the default client
 * @param {Client} client the new default client
 */
defaultClient.setDefaultClient = function setDefaultClient(client) {
	target = client;
};

/**
 * Obtain a direct reference to the current default client
 * @returns {Client} the default client
 */
defaultClient.getDefaultClient = function getDefaultClient() {
	return target;
};

/**
 * Reset the default client to the platform default
 */
defaultClient.resetDefaultClient = function resetDefaultClient() {
	target = platformDefault;
};

/**
 * @private
 */
defaultClient.setPlatformDefaultClient = function setPlatformDefaultClient(client) {
	if (platformDefault) {
		throw new Error('Unable to redefine platformDefaultClient');
	}
	target = platformDefault = client;
};

module.exports = client(defaultClient);

},{"../client":27}],29:[function(require,module,exports){
/*
 * Copyright 2012-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

var normalizeHeaderName, responsePromise, client, headerSplitRE;

normalizeHeaderName = require('../util/normalizeHeaderName');
responsePromise = require('../util/responsePromise');
client = require('../client');

// according to the spec, the line break is '\r\n', but doesn't hold true in practice
headerSplitRE = /[\r|\n]+/;

function parseHeaders(raw) {
	// Note: Set-Cookie will be removed by the browser
	var headers = {};

	if (!raw) { return headers; }

	raw.trim().split(headerSplitRE).forEach(function (header) {
		var boundary, name, value;
		boundary = header.indexOf(':');
		name = normalizeHeaderName(header.substring(0, boundary).trim());
		value = header.substring(boundary + 1).trim();
		if (headers[name]) {
			if (Array.isArray(headers[name])) {
				// add to an existing array
				headers[name].push(value);
			}
			else {
				// convert single value to array
				headers[name] = [headers[name], value];
			}
		}
		else {
			// new, single value
			headers[name] = value;
		}
	});

	return headers;
}

function safeMixin(target, source) {
	Object.keys(source || {}).forEach(function (prop) {
		// make sure the property already exists as
		// IE 6 will blow up if we add a new prop
		if (source.hasOwnProperty(prop) && prop in target) {
			try {
				target[prop] = source[prop];
			}
			catch (e) {
				// ignore, expected for some properties at some points in the request lifecycle
			}
		}
	});

	return target;
}

module.exports = client(function xhr(request) {
	return responsePromise.promise(function (resolve, reject) {
		/*jshint maxcomplexity:20 */

		var client, method, url, headers, entity, headerName, response, XHR;

		request = typeof request === 'string' ? { path: request } : request || {};
		response = { request: request };

		if (request.canceled) {
			response.error = 'precanceled';
			reject(response);
			return;
		}

		XHR = request.engine || XMLHttpRequest;
		if (!XHR) {
			reject({ request: request, error: 'xhr-not-available' });
			return;
		}

		entity = request.entity;
		request.method = request.method || (entity ? 'POST' : 'GET');
		method = request.method;
		url = response.url = request.path || '';

		try {
			client = response.raw = new XHR();

			// mixin extra request properties before and after opening the request as some properties require being set at different phases of the request
			safeMixin(client, request.mixin);
			client.open(method, url, true);
			safeMixin(client, request.mixin);

			headers = request.headers;
			for (headerName in headers) {
				/*jshint forin:false */
				if (headerName === 'Content-Type' && headers[headerName] === 'multipart/form-data') {
					// XMLHttpRequest generates its own Content-Type header with the
					// appropriate multipart boundary when sending multipart/form-data.
					continue;
				}

				client.setRequestHeader(headerName, headers[headerName]);
			}

			request.canceled = false;
			request.cancel = function cancel() {
				request.canceled = true;
				client.abort();
				reject(response);
			};

			client.onreadystatechange = function (/* e */) {
				if (request.canceled) { return; }
				if (client.readyState === (XHR.DONE || 4)) {
					response.status = {
						code: client.status,
						text: client.statusText
					};
					response.headers = parseHeaders(client.getAllResponseHeaders());
					response.entity = client.responseText;

					// #125 -- Sometimes IE8-9 uses 1223 instead of 204
					// http://stackoverflow.com/questions/10046972/msie-returns-status-code-of-1223-for-ajax-request
					if (response.status.code === 1223) {
						response.status.code = 204;
					}

					if (response.status.code > 0) {
						// check status code as readystatechange fires before error event
						resolve(response);
					}
					else {
						// give the error callback a chance to fire before resolving
						// requests for file:// URLs do not have a status code
						setTimeout(function () {
							resolve(response);
						}, 0);
					}
				}
			};

			try {
				client.onerror = function (/* e */) {
					response.error = 'loaderror';
					reject(response);
				};
			}
			catch (e) {
				// IE 6 will not support error handling
			}

			client.send(entity);
		}
		catch (e) {
			response.error = 'loaderror';
			reject(response);
		}

	});
});

},{"../client":27,"../util/normalizeHeaderName":49,"../util/responsePromise":50}],30:[function(require,module,exports){
/*
 * Copyright 2012-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

var defaultClient, mixin, responsePromise, client;

defaultClient = require('./client/default');
mixin = require('./util/mixin');
responsePromise = require('./util/responsePromise');
client = require('./client');

/**
 * Interceptors have the ability to intercept the request and/org response
 * objects.  They may augment, prune, transform or replace the
 * request/response as needed.  Clients may be composed by wrapping
 * together multiple interceptors.
 *
 * Configured interceptors are functional in nature.  Wrapping a client in
 * an interceptor will not affect the client, merely the data that flows in
 * and out of that client.  A common configuration can be created once and
 * shared; specialization can be created by further wrapping that client
 * with custom interceptors.
 *
 * @param {Client} [target] client to wrap
 * @param {Object} [config] configuration for the interceptor, properties will be specific to the interceptor implementation
 * @returns {Client} A client wrapped with the interceptor
 *
 * @class Interceptor
 */

function defaultInitHandler(config) {
	return config;
}

function defaultRequestHandler(request /*, config, meta */) {
	return request;
}

function defaultResponseHandler(response /*, config, meta */) {
	return response;
}

/**
 * Alternate return type for the request handler that allows for more complex interactions.
 *
 * @param properties.request the traditional request return object
 * @param {Promise} [properties.abort] promise that resolves if/when the request is aborted
 * @param {Client} [properties.client] override the defined client with an alternate client
 * @param [properties.response] response for the request, short circuit the request
 */
function ComplexRequest(properties) {
	if (!(this instanceof ComplexRequest)) {
		// in case users forget the 'new' don't mix into the interceptor
		return new ComplexRequest(properties);
	}
	mixin(this, properties);
}

/**
 * Create a new interceptor for the provided handlers.
 *
 * @param {Function} [handlers.init] one time intialization, must return the config object
 * @param {Function} [handlers.request] request handler
 * @param {Function} [handlers.response] response handler regardless of error state
 * @param {Function} [handlers.success] response handler when the request is not in error
 * @param {Function} [handlers.error] response handler when the request is in error, may be used to 'unreject' an error state
 * @param {Function} [handlers.client] the client to use if otherwise not specified, defaults to platform default client
 *
 * @returns {Interceptor}
 */
function interceptor(handlers) {

	var initHandler, requestHandler, successResponseHandler, errorResponseHandler;

	handlers = handlers || {};

	initHandler            = handlers.init    || defaultInitHandler;
	requestHandler         = handlers.request || defaultRequestHandler;
	successResponseHandler = handlers.success || handlers.response || defaultResponseHandler;
	errorResponseHandler   = handlers.error   || function () {
		// Propagate the rejection, with the result of the handler
		return Promise.resolve((handlers.response || defaultResponseHandler).apply(this, arguments))
			.then(Promise.reject.bind(Promise));
	};

	return function (target, config) {

		if (typeof target === 'object') {
			config = target;
		}
		if (typeof target !== 'function') {
			target = handlers.client || defaultClient;
		}

		config = initHandler(config || {});

		function interceptedClient(request) {
			var context, meta;
			context = {};
			meta = { 'arguments': Array.prototype.slice.call(arguments), client: interceptedClient };
			request = typeof request === 'string' ? { path: request } : request || {};
			request.originator = request.originator || interceptedClient;
			return responsePromise(
				requestHandler.call(context, request, config, meta),
				function (request) {
					var response, abort, next;
					next = target;
					if (request instanceof ComplexRequest) {
						// unpack request
						abort = request.abort;
						next = request.client || next;
						response = request.response;
						// normalize request, must be last
						request = request.request;
					}
					response = response || Promise.resolve(request).then(function (request) {
						return Promise.resolve(next(request)).then(
							function (response) {
								return successResponseHandler.call(context, response, config, meta);
							},
							function (response) {
								return errorResponseHandler.call(context, response, config, meta);
							}
						);
					});
					return abort ? Promise.race([response, abort]) : response;
				},
				function (error) {
					return Promise.reject({ request: request, error: error });
				}
			);
		}

		return client(interceptedClient, target);
	};
}

interceptor.ComplexRequest = ComplexRequest;

module.exports = interceptor;

},{"./client":27,"./client/default":28,"./util/mixin":48,"./util/responsePromise":50}],31:[function(require,module,exports){
/*
 * Copyright 2013-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

var interceptor, mixinUtil, defaulter;

interceptor = require('../interceptor');
mixinUtil = require('../util/mixin');

defaulter = (function () {

	function mixin(prop, target, defaults) {
		if (prop in target || prop in defaults) {
			target[prop] = mixinUtil({}, defaults[prop], target[prop]);
		}
	}

	function copy(prop, target, defaults) {
		if (prop in defaults && !(prop in target)) {
			target[prop] = defaults[prop];
		}
	}

	var mappings = {
		method: copy,
		path: copy,
		params: mixin,
		headers: mixin,
		entity: copy,
		mixin: mixin
	};

	return function (target, defaults) {
		for (var prop in mappings) {
			/*jshint forin: false */
			mappings[prop](prop, target, defaults);
		}
		return target;
	};

}());

/**
 * Provide default values for a request. These values will be applied to the
 * request if the request object does not already contain an explicit value.
 *
 * For 'params', 'headers', and 'mixin', individual values are mixed in with the
 * request's values. The result is a new object representiing the combined
 * request and config values. Neither input object is mutated.
 *
 * @param {Client} [client] client to wrap
 * @param {string} [config.method] the default method
 * @param {string} [config.path] the default path
 * @param {Object} [config.params] the default params, mixed with the request's existing params
 * @param {Object} [config.headers] the default headers, mixed with the request's existing headers
 * @param {Object} [config.mixin] the default "mixins" (http/https options), mixed with the request's existing "mixins"
 *
 * @returns {Client}
 */
module.exports = interceptor({
	request: function handleRequest(request, config) {
		return defaulter(request, config);
	}
});

},{"../interceptor":30,"../util/mixin":48}],32:[function(require,module,exports){
/*
 * Copyright 2012-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

var interceptor;

interceptor = require('../interceptor');

/**
 * Rejects the response promise based on the status code.
 *
 * Codes greater than or equal to the provided value are rejected.  Default
 * value 400.
 *
 * @param {Client} [client] client to wrap
 * @param {number} [config.code=400] code to indicate a rejection
 *
 * @returns {Client}
 */
module.exports = interceptor({
	init: function (config) {
		config.code = config.code || 400;
		return config;
	},
	response: function (response, config) {
		if (response.status && response.status.code >= config.code) {
			return Promise.reject(response);
		}
		return response;
	}
});

},{"../interceptor":30}],33:[function(require,module,exports){
/*
 * Copyright 2012-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

var interceptor, mime, registry, noopConverter, missingConverter, attempt;

interceptor = require('../interceptor');
mime = require('../mime');
registry = require('../mime/registry');
attempt = require('../util/attempt');

noopConverter = {
	read: function (obj) { return obj; },
	write: function (obj) { return obj; }
};

missingConverter = {
	read: function () { throw 'No read method found on converter'; },
	write: function () { throw 'No write method found on converter'; }
};

/**
 * MIME type support for request and response entities.  Entities are
 * (de)serialized using the converter for the MIME type.
 *
 * Request entities are converted using the desired converter and the
 * 'Accept' request header prefers this MIME.
 *
 * Response entities are converted based on the Content-Type response header.
 *
 * @param {Client} [client] client to wrap
 * @param {string} [config.mime='text/plain'] MIME type to encode the request
 *   entity
 * @param {string} [config.accept] Accept header for the request
 * @param {Client} [config.client=<request.originator>] client passed to the
 *   converter, defaults to the client originating the request
 * @param {Registry} [config.registry] MIME registry, defaults to the root
 *   registry
 * @param {boolean} [config.permissive] Allow an unkown request MIME type
 *
 * @returns {Client}
 */
module.exports = interceptor({
	init: function (config) {
		config.registry = config.registry || registry;
		return config;
	},
	request: function (request, config) {
		var type, headers;

		headers = request.headers || (request.headers = {});
		type = mime.parse(headers['Content-Type'] || config.mime || 'text/plain');
		headers.Accept = headers.Accept || config.accept || type.raw + ', application/json;q=0.8, text/plain;q=0.5, */*;q=0.2';

		if (!('entity' in request)) {
			return request;
		}

		headers['Content-Type'] = type.raw;

		return config.registry.lookup(type)['catch'](function () {
			// failed to resolve converter
			if (config.permissive) {
				return noopConverter;
			}
			throw 'mime-unknown';
		}).then(function (converter) {
			var client = config.client || request.originator,
				write = converter.write || missingConverter.write;

			return attempt(write.bind(void 0, request.entity, { client: client, request: request, mime: type, registry: config.registry }))
				['catch'](function() {
					throw 'mime-serialization';
				})
				.then(function(entity) {
					request.entity = entity;
					return request;
				});
		});
	},
	response: function (response, config) {
		if (!(response.headers && response.headers['Content-Type'] && response.entity)) {
			return response;
		}

		var type = mime.parse(response.headers['Content-Type']);

		return config.registry.lookup(type)['catch'](function () { return noopConverter; }).then(function (converter) {
			var client = config.client || response.request && response.request.originator,
				read = converter.read || missingConverter.read;

			return attempt(read.bind(void 0, response.entity, { client: client, response: response, mime: type, registry: config.registry }))
				['catch'](function (e) {
					response.error = 'mime-deserialization';
					response.cause = e;
					throw response;
				})
				.then(function (entity) {
					response.entity = entity;
					return response;
				});
		});
	}
});

},{"../interceptor":30,"../mime":36,"../mime/registry":37,"../util/attempt":44}],34:[function(require,module,exports){
/*
 * Copyright 2012-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

var interceptor, UrlBuilder;

interceptor = require('../interceptor');
UrlBuilder = require('../UrlBuilder');

function startsWith(str, prefix) {
	return str.indexOf(prefix) === 0;
}

function endsWith(str, suffix) {
	return str.lastIndexOf(suffix) + suffix.length === str.length;
}

/**
 * Prefixes the request path with a common value.
 *
 * @param {Client} [client] client to wrap
 * @param {number} [config.prefix] path prefix
 *
 * @returns {Client}
 */
module.exports = interceptor({
	request: function (request, config) {
		var path;

		if (config.prefix && !(new UrlBuilder(request.path).isFullyQualified())) {
			path = config.prefix;
			if (request.path) {
				if (!endsWith(path, '/') && !startsWith(request.path, '/')) {
					// add missing '/' between path sections
					path += '/';
				}
				path += request.path;
			}
			request.path = path;
		}

		return request;
	}
});

},{"../UrlBuilder":25,"../interceptor":30}],35:[function(require,module,exports){
/*
 * Copyright 2015-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

var interceptor, uriTemplate, mixin;

interceptor = require('../interceptor');
uriTemplate = require('../util/uriTemplate');
mixin = require('../util/mixin');

/**
 * Applies request params to the path as a URI Template
 *
 * Params are removed from the request object, as they have been consumed.
 *
 * @see https://tools.ietf.org/html/rfc6570
 *
 * @param {Client} [client] client to wrap
 * @param {Object} [config.params] default param values
 * @param {string} [config.template] default template
 *
 * @returns {Client}
 */
module.exports = interceptor({
	init: function (config) {
		config.params = config.params || {};
		config.template = config.template || '';
		return config;
	},
	request: function (request, config) {
		var template, params;

		template = request.path || config.template;
		params = mixin({}, request.params, config.params);

		request.path = uriTemplate.expand(template, params);
		delete request.params;

		return request;
	}
});

},{"../interceptor":30,"../util/mixin":48,"../util/uriTemplate":52}],36:[function(require,module,exports){
/*
* Copyright 2014-2016 the original author or authors
* @license MIT, see LICENSE.txt for details
*
* @author Scott Andrews
*/

'use strict';

/**
 * Parse a MIME type into it's constituent parts
 *
 * @param {string} mime MIME type to parse
 * @return {{
 *   {string} raw the original MIME type
 *   {string} type the type and subtype
 *   {string} [suffix] mime suffix, including the plus, if any
 *   {Object} params key/value pair of attributes
 * }}
 */
function parse(mime) {
	var params, type;

	params = mime.split(';');
	type = params[0].trim().split('+');

	return {
		raw: mime,
		type: type[0],
		suffix: type[1] ? '+' + type[1] : '',
		params: params.slice(1).reduce(function (params, pair) {
			pair = pair.split('=');
			params[pair[0].trim()] = pair[1] ? pair[1].trim() : void 0;
			return params;
		}, {})
	};
}

module.exports = {
	parse: parse
};

},{}],37:[function(require,module,exports){
/*
 * Copyright 2012-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

var mime, registry;

mime = require('../mime');

function Registry(mimes) {

	/**
	 * Lookup the converter for a MIME type
	 *
	 * @param {string} type the MIME type
	 * @return a promise for the converter
	 */
	this.lookup = function lookup(type) {
		var parsed;

		parsed = typeof type === 'string' ? mime.parse(type) : type;

		if (mimes[parsed.raw]) {
			return mimes[parsed.raw];
		}
		if (mimes[parsed.type + parsed.suffix]) {
			return mimes[parsed.type + parsed.suffix];
		}
		if (mimes[parsed.type]) {
			return mimes[parsed.type];
		}
		if (mimes[parsed.suffix]) {
			return mimes[parsed.suffix];
		}

		return Promise.reject(new Error('Unable to locate converter for mime "' + parsed.raw + '"'));
	};

	/**
	 * Create a late dispatched proxy to the target converter.
	 *
	 * Common when a converter is registered under multiple names and
	 * should be kept in sync if updated.
	 *
	 * @param {string} type mime converter to dispatch to
	 * @returns converter whose read/write methods target the desired mime converter
	 */
	this.delegate = function delegate(type) {
		return {
			read: function () {
				var args = arguments;
				return this.lookup(type).then(function (converter) {
					return converter.read.apply(this, args);
				}.bind(this));
			}.bind(this),
			write: function () {
				var args = arguments;
				return this.lookup(type).then(function (converter) {
					return converter.write.apply(this, args);
				}.bind(this));
			}.bind(this)
		};
	};

	/**
	 * Register a custom converter for a MIME type
	 *
	 * @param {string} type the MIME type
	 * @param converter the converter for the MIME type
	 * @return a promise for the converter
	 */
	this.register = function register(type, converter) {
		mimes[type] = Promise.resolve(converter);
		return mimes[type];
	};

	/**
	 * Create a child registry whoes registered converters remain local, while
	 * able to lookup converters from its parent.
	 *
	 * @returns child MIME registry
	 */
	this.child = function child() {
		return new Registry(Object.create(mimes));
	};

}

registry = new Registry({});

// include provided serializers
registry.register('application/hal', require('./type/application/hal'));
registry.register('application/json', require('./type/application/json'));
registry.register('application/x-www-form-urlencoded', require('./type/application/x-www-form-urlencoded'));
registry.register('multipart/form-data', require('./type/multipart/form-data'));
registry.register('text/plain', require('./type/text/plain'));

registry.register('+json', registry.delegate('application/json'));

module.exports = registry;

},{"../mime":36,"./type/application/hal":38,"./type/application/json":39,"./type/application/x-www-form-urlencoded":40,"./type/multipart/form-data":41,"./type/text/plain":42}],38:[function(require,module,exports){
/*
 * Copyright 2013-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

var pathPrefix, template, find, lazyPromise, responsePromise;

pathPrefix = require('../../../interceptor/pathPrefix');
template = require('../../../interceptor/template');
find = require('../../../util/find');
lazyPromise = require('../../../util/lazyPromise');
responsePromise = require('../../../util/responsePromise');

function defineProperty(obj, name, value) {
	Object.defineProperty(obj, name, {
		value: value,
		configurable: true,
		enumerable: false,
		writeable: true
	});
}

/**
 * Hypertext Application Language serializer
 *
 * Implemented to https://tools.ietf.org/html/draft-kelly-json-hal-06
 *
 * As the spec is still a draft, this implementation will be updated as the
 * spec evolves
 *
 * Objects are read as HAL indexing links and embedded objects on to the
 * resource. Objects are written as plain JSON.
 *
 * Embedded relationships are indexed onto the resource by the relationship
 * as a promise for the related resource.
 *
 * Links are indexed onto the resource as a lazy promise that will GET the
 * resource when a handler is first registered on the promise.
 *
 * A `requestFor` method is added to the entity to make a request for the
 * relationship.
 *
 * A `clientFor` method is added to the entity to get a full Client for a
 * relationship.
 *
 * The `_links` and `_embedded` properties on the resource are made
 * non-enumerable.
 */
module.exports = {

	read: function (str, opts) {
		var client, console;

		opts = opts || {};
		client = opts.client;
		console = opts.console || console;

		function deprecationWarning(relationship, deprecation) {
			if (deprecation && console && console.warn || console.log) {
				(console.warn || console.log).call(console, 'Relationship \'' + relationship + '\' is deprecated, see ' + deprecation);
			}
		}

		return opts.registry.lookup(opts.mime.suffix).then(function (converter) {
			return converter.read(str, opts);
		}).then(function (root) {
			find.findProperties(root, '_embedded', function (embedded, resource, name) {
				Object.keys(embedded).forEach(function (relationship) {
					if (relationship in resource) { return; }
					var related = responsePromise({
						entity: embedded[relationship]
					});
					defineProperty(resource, relationship, related);
				});
				defineProperty(resource, name, embedded);
			});
			find.findProperties(root, '_links', function (links, resource, name) {
				Object.keys(links).forEach(function (relationship) {
					var link = links[relationship];
					if (relationship in resource) { return; }
					defineProperty(resource, relationship, responsePromise.make(lazyPromise(function () {
						if (link.deprecation) { deprecationWarning(relationship, link.deprecation); }
						if (link.templated === true) {
							return template(client)({ path: link.href });
						}
						return client({ path: link.href });
					})));
				});
				defineProperty(resource, name, links);
				defineProperty(resource, 'clientFor', function (relationship, clientOverride) {
					var link = links[relationship];
					if (!link) {
						throw new Error('Unknown relationship: ' + relationship);
					}
					if (link.deprecation) { deprecationWarning(relationship, link.deprecation); }
					if (link.templated === true) {
						return template(
							clientOverride || client,
							{ template: link.href }
						);
					}
					return pathPrefix(
						clientOverride || client,
						{ prefix: link.href }
					);
				});
				defineProperty(resource, 'requestFor', function (relationship, request, clientOverride) {
					var client = this.clientFor(relationship, clientOverride);
					return client(request);
				});
			});

			return root;
		});

	},

	write: function (obj, opts) {
		return opts.registry.lookup(opts.mime.suffix).then(function (converter) {
			return converter.write(obj, opts);
		});
	}

};

},{"../../../interceptor/pathPrefix":34,"../../../interceptor/template":35,"../../../util/find":46,"../../../util/lazyPromise":47,"../../../util/responsePromise":50}],39:[function(require,module,exports){
/*
 * Copyright 2012-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

/**
 * Create a new JSON converter with custom reviver/replacer.
 *
 * The extended converter must be published to a MIME registry in order
 * to be used. The existing converter will not be modified.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON
 *
 * @param {function} [reviver=undefined] custom JSON.parse reviver
 * @param {function|Array} [replacer=undefined] custom JSON.stringify replacer
 */
function createConverter(reviver, replacer) {
	return {

		read: function (str) {
			return JSON.parse(str, reviver);
		},

		write: function (obj) {
			return JSON.stringify(obj, replacer);
		},

		extend: createConverter

	};
}

module.exports = createConverter();

},{}],40:[function(require,module,exports){
/*
 * Copyright 2012-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

var encodedSpaceRE, urlEncodedSpaceRE;

encodedSpaceRE = /%20/g;
urlEncodedSpaceRE = /\+/g;

function urlEncode(str) {
	str = encodeURIComponent(str);
	// spec says space should be encoded as '+'
	return str.replace(encodedSpaceRE, '+');
}

function urlDecode(str) {
	// spec says space should be encoded as '+'
	str = str.replace(urlEncodedSpaceRE, ' ');
	return decodeURIComponent(str);
}

function append(str, name, value) {
	if (Array.isArray(value)) {
		value.forEach(function (value) {
			str = append(str, name, value);
		});
	}
	else {
		if (str.length > 0) {
			str += '&';
		}
		str += urlEncode(name);
		if (value !== undefined && value !== null) {
			str += '=' + urlEncode(value);
		}
	}
	return str;
}

module.exports = {

	read: function (str) {
		var obj = {};
		str.split('&').forEach(function (entry) {
			var pair, name, value;
			pair = entry.split('=');
			name = urlDecode(pair[0]);
			if (pair.length === 2) {
				value = urlDecode(pair[1]);
			}
			else {
				value = null;
			}
			if (name in obj) {
				if (!Array.isArray(obj[name])) {
					// convert to an array, perserving currnent value
					obj[name] = [obj[name]];
				}
				obj[name].push(value);
			}
			else {
				obj[name] = value;
			}
		});
		return obj;
	},

	write: function (obj) {
		var str = '';
		Object.keys(obj).forEach(function (name) {
			str = append(str, name, obj[name]);
		});
		return str;
	}

};

},{}],41:[function(require,module,exports){
/*
 * Copyright 2014-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Michael Jackson
 */

/* global FormData, File, Blob */

'use strict';

function isFormElement(object) {
	return object &&
		object.nodeType === 1 && // Node.ELEMENT_NODE
		object.tagName === 'FORM';
}

function createFormDataFromObject(object) {
	var formData = new FormData();

	var value;
	for (var property in object) {
		if (object.hasOwnProperty(property)) {
			value = object[property];

			if (value instanceof File) {
				formData.append(property, value, value.name);
			} else if (value instanceof Blob) {
				formData.append(property, value);
			} else {
				formData.append(property, String(value));
			}
		}
	}

	return formData;
}

module.exports = {

	write: function (object) {
		if (typeof FormData === 'undefined') {
			throw new Error('The multipart/form-data mime serializer requires FormData support');
		}

		// Support FormData directly.
		if (object instanceof FormData) {
			return object;
		}

		// Support <form> elements.
		if (isFormElement(object)) {
			return new FormData(object);
		}

		// Support plain objects, may contain File/Blob as value.
		if (typeof object === 'object' && object !== null) {
			return createFormDataFromObject(object);
		}

		throw new Error('Unable to create FormData from object ' + object);
	}

};

},{}],42:[function(require,module,exports){
/*
 * Copyright 2012-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

module.exports = {

	read: function (str) {
		return str;
	},

	write: function (obj) {
		return obj.toString();
	}

};

},{}],43:[function(require,module,exports){
module.exports = (function(){
  /*
   * Generated by PEG.js 0.7.0.
   *
   * http://pegjs.majda.cz/
   */

  function quote(s) {
    /*
     * ECMA-262, 5th ed., 7.8.4: All characters may appear literally in a
     * string literal except for the closing quote character, backslash,
     * carriage return, line separator, paragraph separator, and line feed.
     * Any character may appear in the form of an escape sequence.
     *
     * For portability, we also escape escape all control and non-ASCII
     * characters. Note that "\0" and "\v" escape sequences are not used
     * because JSHint does not like the first and IE the second.
     */
     return '"' + s
      .replace(/\\/g, '\\\\')  // backslash
      .replace(/"/g, '\\"')    // closing quote character
      .replace(/\x08/g, '\\b') // backspace
      .replace(/\t/g, '\\t')   // horizontal tab
      .replace(/\n/g, '\\n')   // line feed
      .replace(/\f/g, '\\f')   // form feed
      .replace(/\r/g, '\\r')   // carriage return
      .replace(/[\x00-\x07\x0B\x0E-\x1F\x80-\uFFFF]/g, escape)
      + '"';
  }

  var result = {
    /*
     * Parses the input with a generated parser. If the parsing is successfull,
     * returns a value explicitly or implicitly specified by the grammar from
     * which the parser was generated (see |PEG.buildParser|). If the parsing is
     * unsuccessful, throws |PEG.parser.SyntaxError| describing the error.
     */
    parse: function(input, startRule) {
      var parseFunctions = {
        "start": parse_start,
        "LinkValue": parse_LinkValue,
        "LinkParams": parse_LinkParams,
        "URIReference": parse_URIReference,
        "LinkParam": parse_LinkParam,
        "LinkParamName": parse_LinkParamName,
        "LinkParamValue": parse_LinkParamValue,
        "PToken": parse_PToken,
        "PTokenChar": parse_PTokenChar,
        "OptionalSP": parse_OptionalSP,
        "QuotedString": parse_QuotedString,
        "QuotedStringInternal": parse_QuotedStringInternal,
        "Char": parse_Char,
        "UpAlpha": parse_UpAlpha,
        "LoAlpha": parse_LoAlpha,
        "Alpha": parse_Alpha,
        "Digit": parse_Digit,
        "SP": parse_SP,
        "DQ": parse_DQ,
        "QDText": parse_QDText,
        "QuotedPair": parse_QuotedPair
      };

      if (startRule !== undefined) {
        if (parseFunctions[startRule] === undefined) {
          throw new Error("Invalid rule name: " + quote(startRule) + ".");
        }
      } else {
        startRule = "start";
      }

      var pos = 0;
      var reportFailures = 0;
      var rightmostFailuresPos = 0;
      var rightmostFailuresExpected = [];

      function padLeft(input, padding, length) {
        var result = input;

        var padLength = length - input.length;
        for (var i = 0; i < padLength; i++) {
          result = padding + result;
        }

        return result;
      }

      function escape(ch) {
        var charCode = ch.charCodeAt(0);
        var escapeChar;
        var length;

        if (charCode <= 0xFF) {
          escapeChar = 'x';
          length = 2;
        } else {
          escapeChar = 'u';
          length = 4;
        }

        return '\\' + escapeChar + padLeft(charCode.toString(16).toUpperCase(), '0', length);
      }

      function matchFailed(failure) {
        if (pos < rightmostFailuresPos) {
          return;
        }

        if (pos > rightmostFailuresPos) {
          rightmostFailuresPos = pos;
          rightmostFailuresExpected = [];
        }

        rightmostFailuresExpected.push(failure);
      }

      function parse_start() {
        var result0, result1, result2, result3, result4;
        var pos0, pos1, pos2, pos3;

        pos0 = pos;
        pos1 = pos;
        result0 = [];
        pos2 = pos;
        pos3 = pos;
        result1 = parse_LinkValue();
        if (result1 !== null) {
          result2 = parse_OptionalSP();
          if (result2 !== null) {
            if (input.charCodeAt(pos) === 44) {
              result3 = ",";
              pos++;
            } else {
              result3 = null;
              if (reportFailures === 0) {
                matchFailed("\",\"");
              }
            }
            if (result3 !== null) {
              result4 = parse_OptionalSP();
              if (result4 !== null) {
                result1 = [result1, result2, result3, result4];
              } else {
                result1 = null;
                pos = pos3;
              }
            } else {
              result1 = null;
              pos = pos3;
            }
          } else {
            result1 = null;
            pos = pos3;
          }
        } else {
          result1 = null;
          pos = pos3;
        }
        if (result1 !== null) {
          result1 = (function(offset, i) {return i;})(pos2, result1[0]);
        }
        if (result1 === null) {
          pos = pos2;
        }
        while (result1 !== null) {
          result0.push(result1);
          pos2 = pos;
          pos3 = pos;
          result1 = parse_LinkValue();
          if (result1 !== null) {
            result2 = parse_OptionalSP();
            if (result2 !== null) {
              if (input.charCodeAt(pos) === 44) {
                result3 = ",";
                pos++;
              } else {
                result3 = null;
                if (reportFailures === 0) {
                  matchFailed("\",\"");
                }
              }
              if (result3 !== null) {
                result4 = parse_OptionalSP();
                if (result4 !== null) {
                  result1 = [result1, result2, result3, result4];
                } else {
                  result1 = null;
                  pos = pos3;
                }
              } else {
                result1 = null;
                pos = pos3;
              }
            } else {
              result1 = null;
              pos = pos3;
            }
          } else {
            result1 = null;
            pos = pos3;
          }
          if (result1 !== null) {
            result1 = (function(offset, i) {return i;})(pos2, result1[0]);
          }
          if (result1 === null) {
            pos = pos2;
          }
        }
        if (result0 !== null) {
          result1 = parse_LinkValue();
          if (result1 !== null) {
            result0 = [result0, result1];
          } else {
            result0 = null;
            pos = pos1;
          }
        } else {
          result0 = null;
          pos = pos1;
        }
        if (result0 !== null) {
          result0 = (function(offset, start, last) { return start.concat([last]) })(pos0, result0[0], result0[1]);
        }
        if (result0 === null) {
          pos = pos0;
        }
        return result0;
      }

      function parse_LinkValue() {
        var result0, result1, result2, result3, result4, result5;
        var pos0, pos1;

        pos0 = pos;
        pos1 = pos;
        if (input.charCodeAt(pos) === 60) {
          result0 = "<";
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("\"<\"");
          }
        }
        if (result0 !== null) {
          result1 = parse_URIReference();
          if (result1 !== null) {
            if (input.charCodeAt(pos) === 62) {
              result2 = ">";
              pos++;
            } else {
              result2 = null;
              if (reportFailures === 0) {
                matchFailed("\">\"");
              }
            }
            if (result2 !== null) {
              result3 = parse_OptionalSP();
              if (result3 !== null) {
                result4 = [];
                result5 = parse_LinkParams();
                while (result5 !== null) {
                  result4.push(result5);
                  result5 = parse_LinkParams();
                }
                if (result4 !== null) {
                  result0 = [result0, result1, result2, result3, result4];
                } else {
                  result0 = null;
                  pos = pos1;
                }
              } else {
                result0 = null;
                pos = pos1;
              }
            } else {
              result0 = null;
              pos = pos1;
            }
          } else {
            result0 = null;
            pos = pos1;
          }
        } else {
          result0 = null;
          pos = pos1;
        }
        if (result0 !== null) {
          result0 = (function(offset, href, params) {
            var link = {};
            params.forEach(function (param) {
              link[param[0]] = param[1];
            });
            link.href = href;
            return link;
          })(pos0, result0[1], result0[4]);
        }
        if (result0 === null) {
          pos = pos0;
        }
        return result0;
      }

      function parse_LinkParams() {
        var result0, result1, result2, result3;
        var pos0, pos1;

        pos0 = pos;
        pos1 = pos;
        if (input.charCodeAt(pos) === 59) {
          result0 = ";";
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("\";\"");
          }
        }
        if (result0 !== null) {
          result1 = parse_OptionalSP();
          if (result1 !== null) {
            result2 = parse_LinkParam();
            if (result2 !== null) {
              result3 = parse_OptionalSP();
              if (result3 !== null) {
                result0 = [result0, result1, result2, result3];
              } else {
                result0 = null;
                pos = pos1;
              }
            } else {
              result0 = null;
              pos = pos1;
            }
          } else {
            result0 = null;
            pos = pos1;
          }
        } else {
          result0 = null;
          pos = pos1;
        }
        if (result0 !== null) {
          result0 = (function(offset, param) { return param })(pos0, result0[2]);
        }
        if (result0 === null) {
          pos = pos0;
        }
        return result0;
      }

      function parse_URIReference() {
        var result0, result1;
        var pos0;

        pos0 = pos;
        if (/^[^>]/.test(input.charAt(pos))) {
          result1 = input.charAt(pos);
          pos++;
        } else {
          result1 = null;
          if (reportFailures === 0) {
            matchFailed("[^>]");
          }
        }
        if (result1 !== null) {
          result0 = [];
          while (result1 !== null) {
            result0.push(result1);
            if (/^[^>]/.test(input.charAt(pos))) {
              result1 = input.charAt(pos);
              pos++;
            } else {
              result1 = null;
              if (reportFailures === 0) {
                matchFailed("[^>]");
              }
            }
          }
        } else {
          result0 = null;
        }
        if (result0 !== null) {
          result0 = (function(offset, url) { return url.join('') })(pos0, result0);
        }
        if (result0 === null) {
          pos = pos0;
        }
        return result0;
      }

      function parse_LinkParam() {
        var result0, result1;
        var pos0, pos1;

        pos0 = pos;
        pos1 = pos;
        result0 = parse_LinkParamName();
        if (result0 !== null) {
          result1 = parse_LinkParamValue();
          result1 = result1 !== null ? result1 : "";
          if (result1 !== null) {
            result0 = [result0, result1];
          } else {
            result0 = null;
            pos = pos1;
          }
        } else {
          result0 = null;
          pos = pos1;
        }
        if (result0 !== null) {
          result0 = (function(offset, name, value) { return [name, value] })(pos0, result0[0], result0[1]);
        }
        if (result0 === null) {
          pos = pos0;
        }
        return result0;
      }

      function parse_LinkParamName() {
        var result0, result1;
        var pos0;

        pos0 = pos;
        if (/^[a-z]/.test(input.charAt(pos))) {
          result1 = input.charAt(pos);
          pos++;
        } else {
          result1 = null;
          if (reportFailures === 0) {
            matchFailed("[a-z]");
          }
        }
        if (result1 !== null) {
          result0 = [];
          while (result1 !== null) {
            result0.push(result1);
            if (/^[a-z]/.test(input.charAt(pos))) {
              result1 = input.charAt(pos);
              pos++;
            } else {
              result1 = null;
              if (reportFailures === 0) {
                matchFailed("[a-z]");
              }
            }
          }
        } else {
          result0 = null;
        }
        if (result0 !== null) {
          result0 = (function(offset, name) { return name.join('') })(pos0, result0);
        }
        if (result0 === null) {
          pos = pos0;
        }
        return result0;
      }

      function parse_LinkParamValue() {
        var result0, result1;
        var pos0, pos1;

        pos0 = pos;
        pos1 = pos;
        if (input.charCodeAt(pos) === 61) {
          result0 = "=";
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("\"=\"");
          }
        }
        if (result0 !== null) {
          result1 = parse_PToken();
          if (result1 === null) {
            result1 = parse_QuotedString();
          }
          if (result1 !== null) {
            result0 = [result0, result1];
          } else {
            result0 = null;
            pos = pos1;
          }
        } else {
          result0 = null;
          pos = pos1;
        }
        if (result0 !== null) {
          result0 = (function(offset, str) { return str })(pos0, result0[1]);
        }
        if (result0 === null) {
          pos = pos0;
        }
        return result0;
      }

      function parse_PToken() {
        var result0, result1;
        var pos0;

        pos0 = pos;
        result1 = parse_PTokenChar();
        if (result1 !== null) {
          result0 = [];
          while (result1 !== null) {
            result0.push(result1);
            result1 = parse_PTokenChar();
          }
        } else {
          result0 = null;
        }
        if (result0 !== null) {
          result0 = (function(offset, token) { return token.join('') })(pos0, result0);
        }
        if (result0 === null) {
          pos = pos0;
        }
        return result0;
      }

      function parse_PTokenChar() {
        var result0;

        if (input.charCodeAt(pos) === 33) {
          result0 = "!";
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("\"!\"");
          }
        }
        if (result0 === null) {
          if (input.charCodeAt(pos) === 35) {
            result0 = "#";
            pos++;
          } else {
            result0 = null;
            if (reportFailures === 0) {
              matchFailed("\"#\"");
            }
          }
          if (result0 === null) {
            if (input.charCodeAt(pos) === 36) {
              result0 = "$";
              pos++;
            } else {
              result0 = null;
              if (reportFailures === 0) {
                matchFailed("\"$\"");
              }
            }
            if (result0 === null) {
              if (input.charCodeAt(pos) === 37) {
                result0 = "%";
                pos++;
              } else {
                result0 = null;
                if (reportFailures === 0) {
                  matchFailed("\"%\"");
                }
              }
              if (result0 === null) {
                if (input.charCodeAt(pos) === 38) {
                  result0 = "&";
                  pos++;
                } else {
                  result0 = null;
                  if (reportFailures === 0) {
                    matchFailed("\"&\"");
                  }
                }
                if (result0 === null) {
                  if (input.charCodeAt(pos) === 39) {
                    result0 = "'";
                    pos++;
                  } else {
                    result0 = null;
                    if (reportFailures === 0) {
                      matchFailed("\"'\"");
                    }
                  }
                  if (result0 === null) {
                    if (input.charCodeAt(pos) === 40) {
                      result0 = "(";
                      pos++;
                    } else {
                      result0 = null;
                      if (reportFailures === 0) {
                        matchFailed("\"(\"");
                      }
                    }
                    if (result0 === null) {
                      if (input.charCodeAt(pos) === 41) {
                        result0 = ")";
                        pos++;
                      } else {
                        result0 = null;
                        if (reportFailures === 0) {
                          matchFailed("\")\"");
                        }
                      }
                      if (result0 === null) {
                        if (input.charCodeAt(pos) === 42) {
                          result0 = "*";
                          pos++;
                        } else {
                          result0 = null;
                          if (reportFailures === 0) {
                            matchFailed("\"*\"");
                          }
                        }
                        if (result0 === null) {
                          if (input.charCodeAt(pos) === 43) {
                            result0 = "+";
                            pos++;
                          } else {
                            result0 = null;
                            if (reportFailures === 0) {
                              matchFailed("\"+\"");
                            }
                          }
                          if (result0 === null) {
                            if (input.charCodeAt(pos) === 45) {
                              result0 = "-";
                              pos++;
                            } else {
                              result0 = null;
                              if (reportFailures === 0) {
                                matchFailed("\"-\"");
                              }
                            }
                            if (result0 === null) {
                              if (input.charCodeAt(pos) === 46) {
                                result0 = ".";
                                pos++;
                              } else {
                                result0 = null;
                                if (reportFailures === 0) {
                                  matchFailed("\".\"");
                                }
                              }
                              if (result0 === null) {
                                if (input.charCodeAt(pos) === 124) {
                                  result0 = "|";
                                  pos++;
                                } else {
                                  result0 = null;
                                  if (reportFailures === 0) {
                                    matchFailed("\"|\"");
                                  }
                                }
                                if (result0 === null) {
                                  result0 = parse_Digit();
                                  if (result0 === null) {
                                    if (input.charCodeAt(pos) === 58) {
                                      result0 = ":";
                                      pos++;
                                    } else {
                                      result0 = null;
                                      if (reportFailures === 0) {
                                        matchFailed("\":\"");
                                      }
                                    }
                                    if (result0 === null) {
                                      if (input.charCodeAt(pos) === 60) {
                                        result0 = "<";
                                        pos++;
                                      } else {
                                        result0 = null;
                                        if (reportFailures === 0) {
                                          matchFailed("\"<\"");
                                        }
                                      }
                                      if (result0 === null) {
                                        if (input.charCodeAt(pos) === 61) {
                                          result0 = "=";
                                          pos++;
                                        } else {
                                          result0 = null;
                                          if (reportFailures === 0) {
                                            matchFailed("\"=\"");
                                          }
                                        }
                                        if (result0 === null) {
                                          if (input.charCodeAt(pos) === 62) {
                                            result0 = ">";
                                            pos++;
                                          } else {
                                            result0 = null;
                                            if (reportFailures === 0) {
                                              matchFailed("\">\"");
                                            }
                                          }
                                          if (result0 === null) {
                                            if (input.charCodeAt(pos) === 63) {
                                              result0 = "?";
                                              pos++;
                                            } else {
                                              result0 = null;
                                              if (reportFailures === 0) {
                                                matchFailed("\"?\"");
                                              }
                                            }
                                            if (result0 === null) {
                                              if (input.charCodeAt(pos) === 64) {
                                                result0 = "@";
                                                pos++;
                                              } else {
                                                result0 = null;
                                                if (reportFailures === 0) {
                                                  matchFailed("\"@\"");
                                                }
                                              }
                                              if (result0 === null) {
                                                result0 = parse_Alpha();
                                                if (result0 === null) {
                                                  if (input.charCodeAt(pos) === 91) {
                                                    result0 = "[";
                                                    pos++;
                                                  } else {
                                                    result0 = null;
                                                    if (reportFailures === 0) {
                                                      matchFailed("\"[\"");
                                                    }
                                                  }
                                                  if (result0 === null) {
                                                    if (input.charCodeAt(pos) === 93) {
                                                      result0 = "]";
                                                      pos++;
                                                    } else {
                                                      result0 = null;
                                                      if (reportFailures === 0) {
                                                        matchFailed("\"]\"");
                                                      }
                                                    }
                                                    if (result0 === null) {
                                                      if (input.charCodeAt(pos) === 94) {
                                                        result0 = "^";
                                                        pos++;
                                                      } else {
                                                        result0 = null;
                                                        if (reportFailures === 0) {
                                                          matchFailed("\"^\"");
                                                        }
                                                      }
                                                      if (result0 === null) {
                                                        if (input.charCodeAt(pos) === 95) {
                                                          result0 = "_";
                                                          pos++;
                                                        } else {
                                                          result0 = null;
                                                          if (reportFailures === 0) {
                                                            matchFailed("\"_\"");
                                                          }
                                                        }
                                                        if (result0 === null) {
                                                          if (input.charCodeAt(pos) === 96) {
                                                            result0 = "`";
                                                            pos++;
                                                          } else {
                                                            result0 = null;
                                                            if (reportFailures === 0) {
                                                              matchFailed("\"`\"");
                                                            }
                                                          }
                                                          if (result0 === null) {
                                                            if (input.charCodeAt(pos) === 123) {
                                                              result0 = "{";
                                                              pos++;
                                                            } else {
                                                              result0 = null;
                                                              if (reportFailures === 0) {
                                                                matchFailed("\"{\"");
                                                              }
                                                            }
                                                            if (result0 === null) {
                                                              if (/^[\/\/]/.test(input.charAt(pos))) {
                                                                result0 = input.charAt(pos);
                                                                pos++;
                                                              } else {
                                                                result0 = null;
                                                                if (reportFailures === 0) {
                                                                  matchFailed("[\\/\\/]");
                                                                }
                                                              }
                                                              if (result0 === null) {
                                                                if (input.charCodeAt(pos) === 125) {
                                                                  result0 = "}";
                                                                  pos++;
                                                                } else {
                                                                  result0 = null;
                                                                  if (reportFailures === 0) {
                                                                    matchFailed("\"}\"");
                                                                  }
                                                                }
                                                                if (result0 === null) {
                                                                  if (input.charCodeAt(pos) === 126) {
                                                                    result0 = "~";
                                                                    pos++;
                                                                  } else {
                                                                    result0 = null;
                                                                    if (reportFailures === 0) {
                                                                      matchFailed("\"~\"");
                                                                    }
                                                                  }
                                                                }
                                                              }
                                                            }
                                                          }
                                                        }
                                                      }
                                                    }
                                                  }
                                                }
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        return result0;
      }

      function parse_OptionalSP() {
        var result0, result1;

        result0 = [];
        result1 = parse_SP();
        while (result1 !== null) {
          result0.push(result1);
          result1 = parse_SP();
        }
        return result0;
      }

      function parse_QuotedString() {
        var result0, result1, result2;
        var pos0, pos1;

        pos0 = pos;
        pos1 = pos;
        result0 = parse_DQ();
        if (result0 !== null) {
          result1 = parse_QuotedStringInternal();
          if (result1 !== null) {
            result2 = parse_DQ();
            if (result2 !== null) {
              result0 = [result0, result1, result2];
            } else {
              result0 = null;
              pos = pos1;
            }
          } else {
            result0 = null;
            pos = pos1;
          }
        } else {
          result0 = null;
          pos = pos1;
        }
        if (result0 !== null) {
          result0 = (function(offset, str) { return str })(pos0, result0[1]);
        }
        if (result0 === null) {
          pos = pos0;
        }
        return result0;
      }

      function parse_QuotedStringInternal() {
        var result0, result1;
        var pos0;

        pos0 = pos;
        result0 = [];
        result1 = parse_QDText();
        if (result1 === null) {
          result1 = parse_QuotedPair();
        }
        while (result1 !== null) {
          result0.push(result1);
          result1 = parse_QDText();
          if (result1 === null) {
            result1 = parse_QuotedPair();
          }
        }
        if (result0 !== null) {
          result0 = (function(offset, str) { return str.join('') })(pos0, result0);
        }
        if (result0 === null) {
          pos = pos0;
        }
        return result0;
      }

      function parse_Char() {
        var result0;

        if (/^[\0-]/.test(input.charAt(pos))) {
          result0 = input.charAt(pos);
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("[\\0-]");
          }
        }
        return result0;
      }

      function parse_UpAlpha() {
        var result0;

        if (/^[A-Z]/.test(input.charAt(pos))) {
          result0 = input.charAt(pos);
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("[A-Z]");
          }
        }
        return result0;
      }

      function parse_LoAlpha() {
        var result0;

        if (/^[a-z]/.test(input.charAt(pos))) {
          result0 = input.charAt(pos);
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("[a-z]");
          }
        }
        return result0;
      }

      function parse_Alpha() {
        var result0;

        result0 = parse_UpAlpha();
        if (result0 === null) {
          result0 = parse_LoAlpha();
        }
        return result0;
      }

      function parse_Digit() {
        var result0;

        if (/^[0-9]/.test(input.charAt(pos))) {
          result0 = input.charAt(pos);
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("[0-9]");
          }
        }
        return result0;
      }

      function parse_SP() {
        var result0;

        if (/^[ ]/.test(input.charAt(pos))) {
          result0 = input.charAt(pos);
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("[ ]");
          }
        }
        return result0;
      }

      function parse_DQ() {
        var result0;

        if (/^["]/.test(input.charAt(pos))) {
          result0 = input.charAt(pos);
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("[\"]");
          }
        }
        return result0;
      }

      function parse_QDText() {
        var result0;

        if (/^[^"]/.test(input.charAt(pos))) {
          result0 = input.charAt(pos);
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("[^\"]");
          }
        }
        return result0;
      }

      function parse_QuotedPair() {
        var result0, result1;
        var pos0;

        pos0 = pos;
        if (/^[\\]/.test(input.charAt(pos))) {
          result0 = input.charAt(pos);
          pos++;
        } else {
          result0 = null;
          if (reportFailures === 0) {
            matchFailed("[\\\\]");
          }
        }
        if (result0 !== null) {
          result1 = parse_Char();
          if (result1 !== null) {
            result0 = [result0, result1];
          } else {
            result0 = null;
            pos = pos0;
          }
        } else {
          result0 = null;
          pos = pos0;
        }
        return result0;
      }


      function cleanupExpected(expected) {
        expected.sort();

        var lastExpected = null;
        var cleanExpected = [];
        for (var i = 0; i < expected.length; i++) {
          if (expected[i] !== lastExpected) {
            cleanExpected.push(expected[i]);
            lastExpected = expected[i];
          }
        }
        return cleanExpected;
      }

      function computeErrorPosition() {
        /*
         * The first idea was to use |String.split| to break the input up to the
         * error position along newlines and derive the line and column from
         * there. However IE's |split| implementation is so broken that it was
         * enough to prevent it.
         */

        var line = 1;
        var column = 1;
        var seenCR = false;

        for (var i = 0; i < Math.max(pos, rightmostFailuresPos); i++) {
          var ch = input.charAt(i);
          if (ch === "\n") {
            if (!seenCR) { line++; }
            column = 1;
            seenCR = false;
          } else if (ch === "\r" || ch === "\u2028" || ch === "\u2029") {
            line++;
            column = 1;
            seenCR = true;
          } else {
            column++;
            seenCR = false;
          }
        }

        return { line: line, column: column };
      }


      var result = parseFunctions[startRule]();

      /*
       * The parser is now in one of the following three states:
       *
       * 1. The parser successfully parsed the whole input.
       *
       *    - |result !== null|
       *    - |pos === input.length|
       *    - |rightmostFailuresExpected| may or may not contain something
       *
       * 2. The parser successfully parsed only a part of the input.
       *
       *    - |result !== null|
       *    - |pos < input.length|
       *    - |rightmostFailuresExpected| may or may not contain something
       *
       * 3. The parser did not successfully parse any part of the input.
       *
       *   - |result === null|
       *   - |pos === 0|
       *   - |rightmostFailuresExpected| contains at least one failure
       *
       * All code following this comment (including called functions) must
       * handle these states.
       */
      if (result === null || pos !== input.length) {
        var offset = Math.max(pos, rightmostFailuresPos);
        var found = offset < input.length ? input.charAt(offset) : null;
        var errorPosition = computeErrorPosition();

        throw new this.SyntaxError(
          cleanupExpected(rightmostFailuresExpected),
          found,
          offset,
          errorPosition.line,
          errorPosition.column
        );
      }

      return result;
    },

    /* Returns the parser source code. */
    toSource: function() { return this._source; }
  };

  /* Thrown when a parser encounters a syntax error. */

  result.SyntaxError = function(expected, found, offset, line, column) {
    function buildMessage(expected, found) {
      var expectedHumanized, foundHumanized;

      switch (expected.length) {
        case 0:
          expectedHumanized = "end of input";
          break;
        case 1:
          expectedHumanized = expected[0];
          break;
        default:
          expectedHumanized = expected.slice(0, expected.length - 1).join(", ")
            + " or "
            + expected[expected.length - 1];
      }

      foundHumanized = found ? quote(found) : "end of input";

      return "Expected " + expectedHumanized + " but " + foundHumanized + " found.";
    }

    this.name = "SyntaxError";
    this.expected = expected;
    this.found = found;
    this.message = buildMessage(expected, found);
    this.offset = offset;
    this.line = line;
    this.column = column;
  };

  result.SyntaxError.prototype = Error.prototype;

  return result;
})();

},{}],44:[function(require,module,exports){
/*
 * Copyright 2015-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

/**
 * Attempt to invoke a function capturing the resulting value as a Promise
 *
 * If the method throws, the caught value used to reject the Promise.
 *
 * @param {function} work function to invoke
 * @returns {Promise} Promise for the output of the work function
 */
function attempt(work) {
	try {
		return Promise.resolve(work());
	}
	catch (e) {
		return Promise.reject(e);
	}
}

module.exports = attempt;

},{}],45:[function(require,module,exports){
/*
 * Copyright (c) 2009 Nicholas C. Zakas. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/*
 * Base 64 implementation in JavaScript
 * Original source available at https://raw.github.com/nzakas/computer-science-in-javascript/02a2745b4aa8214f2cae1bf0b15b447ca1a91b23/encodings/base64/base64.js
 *
 * Linter refinement by Scott Andrews
 */

'use strict';

/*jshint bitwise: false */

var digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64-encodes a string of text.
 *
 * @param {string} text The text to encode.
 * @return {string} The base64-encoded string.
 */
function base64Encode(text) {

	if (/([^\u0000-\u00ff])/.test(text)) {
		throw new Error('Can\'t base64 encode non-ASCII characters.');
	}

	var i = 0,
		cur, prev, byteNum,
		result = [];

	while (i < text.length) {

		cur = text.charCodeAt(i);
		byteNum = i % 3;

		switch (byteNum) {
		case 0: //first byte
			result.push(digits.charAt(cur >> 2));
			break;

		case 1: //second byte
			result.push(digits.charAt((prev & 3) << 4 | (cur >> 4)));
			break;

		case 2: //third byte
			result.push(digits.charAt((prev & 0x0f) << 2 | (cur >> 6)));
			result.push(digits.charAt(cur & 0x3f));
			break;
		}

		prev = cur;
		i += 1;
	}

	if (byteNum === 0) {
		result.push(digits.charAt((prev & 3) << 4));
		result.push('==');
	} else if (byteNum === 1) {
		result.push(digits.charAt((prev & 0x0f) << 2));
		result.push('=');
	}

	return result.join('');
}

/**
 * Base64-decodes a string of text.
 *
 * @param {string} text The text to decode.
 * @return {string} The base64-decoded string.
 */
function base64Decode(text) {

	//ignore white space
	text = text.replace(/\s/g, '');

	//first check for any unexpected input
	if (!(/^[a-z0-9\+\/\s]+\={0,2}$/i.test(text)) || text.length % 4 > 0) {
		throw new Error('Not a base64-encoded string.');
	}

	//local variables
	var cur, prev, digitNum,
		i = 0,
		result = [];

	//remove any equals signs
	text = text.replace(/\=/g, '');

	//loop over each character
	while (i < text.length) {

		cur = digits.indexOf(text.charAt(i));
		digitNum = i % 4;

		switch (digitNum) {

		//case 0: first digit - do nothing, not enough info to work with

		case 1: //second digit
			result.push(String.fromCharCode(prev << 2 | cur >> 4));
			break;

		case 2: //third digit
			result.push(String.fromCharCode((prev & 0x0f) << 4 | cur >> 2));
			break;

		case 3: //fourth digit
			result.push(String.fromCharCode((prev & 3) << 6 | cur));
			break;
		}

		prev = cur;
		i += 1;
	}

	//return a string
	return result.join('');

}

module.exports = {
	encode: base64Encode,
	decode: base64Decode
};

},{}],46:[function(require,module,exports){
/*
 * Copyright 2013-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

module.exports = {

	/**
	 * Find objects within a graph the contain a property of a certain name.
	 *
	 * NOTE: this method will not discover object graph cycles.
	 *
	 * @param {*} obj object to search on
	 * @param {string} prop name of the property to search for
	 * @param {Function} callback function to receive the found properties and their parent
	 */
	findProperties: function findProperties(obj, prop, callback) {
		if (typeof obj !== 'object' || obj === null) { return; }
		if (prop in obj) {
			callback(obj[prop], obj, prop);
		}
		Object.keys(obj).forEach(function (key) {
			findProperties(obj[key], prop, callback);
		});
	}

};

},{}],47:[function(require,module,exports){
/*
 * Copyright 2013-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

var attempt = require('./attempt');

/**
 * Create a promise whose work is started only when a handler is registered.
 *
 * The work function will be invoked at most once. Thrown values will result
 * in promise rejection.
 *
 * @param {Function} work function whose ouput is used to resolve the
 *   returned promise.
 * @returns {Promise} a lazy promise
 */
function lazyPromise(work) {
	var started, resolver, promise, then;

	started = false;

	promise = new Promise(function (resolve, reject) {
		resolver = {
			resolve: resolve,
			reject: reject
		};
	});
	then = promise.then;

	promise.then = function () {
		if (!started) {
			started = true;
			attempt(work).then(resolver.resolve, resolver.reject);
		}
		return then.apply(promise, arguments);
	};

	return promise;
}

module.exports = lazyPromise;

},{"./attempt":44}],48:[function(require,module,exports){
/*
 * Copyright 2012-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

var empty = {};

/**
 * Mix the properties from the source object into the destination object.
 * When the same property occurs in more then one object, the right most
 * value wins.
 *
 * @param {Object} dest the object to copy properties to
 * @param {Object} sources the objects to copy properties from.  May be 1 to N arguments, but not an Array.
 * @return {Object} the destination object
 */
function mixin(dest /*, sources... */) {
	var i, l, source, name;

	if (!dest) { dest = {}; }
	for (i = 1, l = arguments.length; i < l; i += 1) {
		source = arguments[i];
		for (name in source) {
			if (!(name in dest) || (dest[name] !== source[name] && (!(name in empty) || empty[name] !== source[name]))) {
				dest[name] = source[name];
			}
		}
	}

	return dest; // Object
}

module.exports = mixin;

},{}],49:[function(require,module,exports){
/*
 * Copyright 2012-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

/**
 * Normalize HTTP header names using the pseudo camel case.
 *
 * For example:
 *   content-type         -> Content-Type
 *   accepts              -> Accepts
 *   x-custom-header-name -> X-Custom-Header-Name
 *
 * @param {string} name the raw header name
 * @return {string} the normalized header name
 */
function normalizeHeaderName(name) {
	return name.toLowerCase()
		.split('-')
		.map(function (chunk) { return chunk.charAt(0).toUpperCase() + chunk.slice(1); })
		.join('-');
}

module.exports = normalizeHeaderName;

},{}],50:[function(require,module,exports){
/*
 * Copyright 2014-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

/*jshint latedef: nofunc */

var normalizeHeaderName = require('./normalizeHeaderName');

function property(promise, name) {
	return promise.then(
		function (value) {
			return value && value[name];
		},
		function (value) {
			return Promise.reject(value && value[name]);
		}
	);
}

/**
 * Obtain the response entity
 *
 * @returns {Promise} for the response entity
 */
function entity() {
	/*jshint validthis:true */
	return property(this, 'entity');
}

/**
 * Obtain the response status
 *
 * @returns {Promise} for the response status
 */
function status() {
	/*jshint validthis:true */
	return property(property(this, 'status'), 'code');
}

/**
 * Obtain the response headers map
 *
 * @returns {Promise} for the response headers map
 */
function headers() {
	/*jshint validthis:true */
	return property(this, 'headers');
}

/**
 * Obtain a specific response header
 *
 * @param {String} headerName the header to retrieve
 * @returns {Promise} for the response header's value
 */
function header(headerName) {
	/*jshint validthis:true */
	headerName = normalizeHeaderName(headerName);
	return property(this.headers(), headerName);
}

/**
 * Follow a related resource
 *
 * The relationship to follow may be define as a plain string, an object
 * with the rel and params, or an array containing one or more entries
 * with the previous forms.
 *
 * Examples:
 *   response.follow('next')
 *
 *   response.follow({ rel: 'next', params: { pageSize: 100 } })
 *
 *   response.follow([
 *       { rel: 'items', params: { projection: 'noImages' } },
 *       'search',
 *       { rel: 'findByGalleryIsNull', params: { projection: 'noImages' } },
 *       'items'
 *   ])
 *
 * @param {String|Object|Array} rels one, or more, relationships to follow
 * @returns ResponsePromise<Response> related resource
 */
function follow(rels) {
	/*jshint validthis:true */
	rels = [].concat(rels);

	return make(rels.reduce(function (response, rel) {
		return response.then(function (response) {
			if (typeof rel === 'string') {
				rel = { rel: rel };
			}
			if (typeof response.entity.clientFor !== 'function') {
				throw new Error('Hypermedia response expected');
			}
			var client = response.entity.clientFor(rel.rel);
			return client({ params: rel.params });
		});
	}, this));
}

/**
 * Wrap a Promise as an ResponsePromise
 *
 * @param {Promise<Response>} promise the promise for an HTTP Response
 * @returns {ResponsePromise<Response>} wrapped promise for Response with additional helper methods
 */
function make(promise) {
	promise.status = status;
	promise.headers = headers;
	promise.header = header;
	promise.entity = entity;
	promise.follow = follow;
	return promise;
}

function responsePromise(obj, callback, errback) {
	return make(Promise.resolve(obj).then(callback, errback));
}

responsePromise.make = make;
responsePromise.reject = function (val) {
	return make(Promise.reject(val));
};
responsePromise.promise = function (func) {
	return make(new Promise(func));
};

module.exports = responsePromise;

},{"./normalizeHeaderName":49}],51:[function(require,module,exports){
/*
 * Copyright 2015-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

var charMap;

charMap = (function () {
	var strings = {
		alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
		digit: '0123456789'
	};

	strings.genDelims = ':/?#[]@';
	strings.subDelims = '!$&\'()*+,;=';
	strings.reserved = strings.genDelims + strings.subDelims;
	strings.unreserved = strings.alpha + strings.digit + '-._~';
	strings.url = strings.reserved + strings.unreserved;
	strings.scheme = strings.alpha + strings.digit + '+-.';
	strings.userinfo = strings.unreserved + strings.subDelims + ':';
	strings.host = strings.unreserved + strings.subDelims;
	strings.port = strings.digit;
	strings.pchar = strings.unreserved + strings.subDelims + ':@';
	strings.segment = strings.pchar;
	strings.path = strings.segment + '/';
	strings.query = strings.pchar + '/?';
	strings.fragment = strings.pchar + '/?';

	return Object.keys(strings).reduce(function (charMap, set) {
		charMap[set] = strings[set].split('').reduce(function (chars, myChar) {
			chars[myChar] = true;
			return chars;
		}, {});
		return charMap;
	}, {});
}());

function encode(str, allowed) {
	if (typeof str !== 'string') {
		throw new Error('String required for URL encoding');
	}
	return str.split('').map(function (myChar) {
		if (allowed.hasOwnProperty(myChar)) {
			return myChar;
		}
		var code = myChar.charCodeAt(0);
		if (code <= 127) {
			var encoded = code.toString(16).toUpperCase();
 			return '%' + (encoded.length % 2 === 1 ? '0' : '') + encoded;
		}
		else {
			return encodeURIComponent(myChar).toUpperCase();
		}
	}).join('');
}

function makeEncoder(allowed) {
	allowed = allowed || charMap.unreserved;
	return function (str) {
		return encode(str, allowed);
	};
}

function decode(str) {
	return decodeURIComponent(str);
}

module.exports = {

	/*
	 * Decode URL encoded strings
	 *
	 * @param {string} URL encoded string
	 * @returns {string} URL decoded string
	 */
	decode: decode,

	/*
	 * URL encode a string
	 *
	 * All but alpha-numerics and a very limited set of punctuation - . _ ~ are
	 * encoded.
	 *
	 * @param {string} string to encode
	 * @returns {string} URL encoded string
	 */
	encode: makeEncoder(),

	/*
	* URL encode a URL
	*
	* All character permitted anywhere in a URL are left unencoded even
	* if that character is not permitted in that portion of a URL.
	*
	* Note: This method is typically not what you want.
	*
	* @param {string} string to encode
	* @returns {string} URL encoded string
	*/
	encodeURL: makeEncoder(charMap.url),

	/*
	 * URL encode the scheme portion of a URL
	 *
	 * @param {string} string to encode
	 * @returns {string} URL encoded string
	 */
	encodeScheme: makeEncoder(charMap.scheme),

	/*
	 * URL encode the user info portion of a URL
	 *
	 * @param {string} string to encode
	 * @returns {string} URL encoded string
	 */
	encodeUserInfo: makeEncoder(charMap.userinfo),

	/*
	 * URL encode the host portion of a URL
	 *
	 * @param {string} string to encode
	 * @returns {string} URL encoded string
	 */
	encodeHost: makeEncoder(charMap.host),

	/*
	 * URL encode the port portion of a URL
	 *
	 * @param {string} string to encode
	 * @returns {string} URL encoded string
	 */
	encodePort: makeEncoder(charMap.port),

	/*
	 * URL encode a path segment portion of a URL
	 *
	 * @param {string} string to encode
	 * @returns {string} URL encoded string
	 */
	encodePathSegment: makeEncoder(charMap.segment),

	/*
	 * URL encode the path portion of a URL
	 *
	 * @param {string} string to encode
	 * @returns {string} URL encoded string
	 */
	encodePath: makeEncoder(charMap.path),

	/*
	 * URL encode the query portion of a URL
	 *
	 * @param {string} string to encode
	 * @returns {string} URL encoded string
	 */
	encodeQuery: makeEncoder(charMap.query),

	/*
	 * URL encode the fragment portion of a URL
	 *
	 * @param {string} string to encode
	 * @returns {string} URL encoded string
	 */
	encodeFragment: makeEncoder(charMap.fragment)

};

},{}],52:[function(require,module,exports){
/*
 * Copyright 2015-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict';

var uriEncoder, operations, prefixRE;

uriEncoder = require('./uriEncoder');

prefixRE = /^([^:]*):([0-9]+)$/;
operations = {
	'':  { first: '',  separator: ',', named: false, empty: '',  encoder: uriEncoder.encode },
	'+': { first: '',  separator: ',', named: false, empty: '',  encoder: uriEncoder.encodeURL },
	'#': { first: '#', separator: ',', named: false, empty: '',  encoder: uriEncoder.encodeURL },
	'.': { first: '.', separator: '.', named: false, empty: '',  encoder: uriEncoder.encode },
	'/': { first: '/', separator: '/', named: false, empty: '',  encoder: uriEncoder.encode },
	';': { first: ';', separator: ';', named: true,  empty: '',  encoder: uriEncoder.encode },
	'?': { first: '?', separator: '&', named: true,  empty: '=', encoder: uriEncoder.encode },
	'&': { first: '&', separator: '&', named: true,  empty: '=', encoder: uriEncoder.encode },
	'=': { reserved: true },
	',': { reserved: true },
	'!': { reserved: true },
	'@': { reserved: true },
	'|': { reserved: true }
};

function apply(operation, expression, params) {
	/*jshint maxcomplexity:11 */
	return expression.split(',').reduce(function (result, variable) {
		var opts, value;

		opts = {};
		if (variable.slice(-1) === '*') {
			variable = variable.slice(0, -1);
			opts.explode = true;
		}
		if (prefixRE.test(variable)) {
			var prefix = prefixRE.exec(variable);
			variable = prefix[1];
			opts.maxLength = parseInt(prefix[2]);
		}

		variable = uriEncoder.decode(variable);
		value = params[variable];

		if (value === void 0 || value === null) {
			return result;
		}
		if (Array.isArray(value)) {
			result = value.reduce(function (result, value) {
				if (result.length) {
					result += opts.explode ? operation.separator : ',';
					if (operation.named && opts.explode) {
						result += operation.encoder(variable);
						result += value.length ? '=' : operation.empty;
					}
				}
				else {
					result += operation.first;
					if (operation.named) {
						result += operation.encoder(variable);
						result += value.length ? '=' : operation.empty;
					}
				}
				result += operation.encoder(value);
				return result;
			}, result);
		}
		else if (typeof value === 'object') {
			result = Object.keys(value).reduce(function (result, name) {
				if (result.length) {
					result += opts.explode ? operation.separator : ',';
				}
				else {
					result += operation.first;
					if (operation.named && !opts.explode) {
						result += operation.encoder(variable);
						result += value[name].length ? '=' : operation.empty;
					}
				}
				result += operation.encoder(name);
				result += opts.explode ? '=' : ',';
				result += operation.encoder(value[name]);
				return result;
			}, result);
		}
		else {
			value = String(value);
			if (opts.maxLength) {
				value = value.slice(0, opts.maxLength);
			}
			result += result.length ? operation.separator : operation.first;
			if (operation.named) {
				result += operation.encoder(variable);
				result += value.length ? '=' : operation.empty;
			}
			result += operation.encoder(value);
		}

		return result;
	}, '');
}

function expandExpression(expression, params) {
	var operation;

	operation = operations[expression.slice(0,1)];
	if (operation) {
		expression = expression.slice(1);
	}
	else {
		operation = operations[''];
	}

	if (operation.reserved) {
		throw new Error('Reserved expression operations are not supported');
	}

	return apply(operation, expression, params);
}

function expandTemplate(template, params) {
	var start, end, uri;

	uri = '';
	end = 0;
	while (true) {
		start = template.indexOf('{', end);
		if (start === -1) {
			// no more expressions
			uri += template.slice(end);
			break;
		}
		uri += template.slice(end, start);
		end = template.indexOf('}', start) + 1;
		uri += expandExpression(template.slice(start + 1, end - 1), params);
	}

	return uri;
}

module.exports = {

	/**
	 * Expand a URI Template with parameters to form a URI.
	 *
	 * Full implementation (level 4) of rfc6570.
	 * @see https://tools.ietf.org/html/rfc6570
	 *
	 * @param {string} template URI template
	 * @param {Object} [params] params to apply to the template durring expantion
	 * @returns {string} expanded URI
	 */
	expand: expandTemplate

};

},{"./uriEncoder":51}],53:[function(require,module,exports){
'use strict';

/**
 * A typeahead component for inputs
 * @class Suggestions
 *
 * @param {HTMLInputElement} el A valid HTML input element
 * @param {Array} data An array of data used for results
 * @param {Object} options
 * @param {Number} [options.limit=5] Max number of results to display in the auto suggest list.
 * @param {Number} [options.minLength=2] Number of characters typed into an input to trigger suggestions.
 * @return {Suggestions} `this`
 * @example
 * // in the browser
 * var input = document.querySelector('input');
 * var data = [
 *   'Roy Eldridge',
 *   'Roy Hargrove',
 *   'Rex Stewart'
 * ];
 *
 * new Suggestions(input, data);
 *
 * // with options
 * var input = document.querySelector('input');
 * var data = [{
 *   name: 'Roy Eldridge',
 *   year: 1911
 * }, {
 *   name: 'Roy Hargrove',
 *   year: 1969
 * }, {
 *   name: 'Rex Stewart',
 *   year: 1907
 * }];
 *
 * var typeahead = new Suggestions(input, data, {
 *   filter: false, // Disable filtering
 *   minLength: 3, // Number of characters typed into an input to trigger suggestions.
 *   limit: 3 //  Max number of results to display.
 * });
 *
 * // As we're passing an object of an arrays as data, override
 * // `getItemValue` by specifying the specific property to search on.
 * typeahead.getItemValue = function(item) { return item.name };
 *
 * input.addEventListener('change', function() {
 *   console.log(typeahead.selected); // Current selected item.
 * });
 *
 * // With browserify
 * var Suggestions = require('suggestions');
 *
 * new Suggestions(input, data);
 */
var Suggestions = require('./src/suggestions');
window.Suggestions = module.exports = Suggestions;

},{"./src/suggestions":55}],54:[function(require,module,exports){
'Use strict';

var List = function(component) {
  this.component = component;
  this.items = [];
  this.active = 0;
  this.element = document.createElement('ul');
  this.element.className = 'suggestions';

  // selectingListItem is set to true in the time between the mousedown and mouseup when clicking an item in the list
  // mousedown on a list item will cause the input to blur which normally hides the list, so this flag is used to keep
  // the list open until the mouseup
  this.selectingListItem = false;

  component.el.parentNode.insertBefore(this.element, component.el.nextSibling);
  return this;
};

List.prototype.show = function() {
  this.element.style.display = 'block';
};

List.prototype.hide = function() {
  this.element.style.display = 'none';
};

List.prototype.add = function(item) {
  this.items.push(item);
};

List.prototype.clear = function() {
  this.items = [];
  this.active = 0;
};

List.prototype.isEmpty = function() {
  return !this.items.length;
};

List.prototype.draw = function() {
  this.element.innerHTML = '';

  if (this.items.length === 0) {
    this.hide();
    return;
  }

  for (var i = 0; i < this.items.length; i++) {
    this.drawItem(this.items[i], this.active === i);
  }

  this.show();
};

List.prototype.drawItem = function(item, active) {
  var li = document.createElement('li'),
    a = document.createElement('a');

  if (active) li.className += ' active';

  a.innerHTML = item.string;

  li.appendChild(a);
  this.element.appendChild(li);

  li.addEventListener('mousedown', function() {
    this.selectingListItem = true;
  }.bind(this));

  li.addEventListener('mouseup', function() {
    this.handleMouseUp.call(this, item);
  }.bind(this));
};

List.prototype.handleMouseUp = function(item) {
  this.selectingListItem = false;
  this.component.value(item.original);
  this.clear();
  this.draw();
};

List.prototype.move = function(index) {
  this.active = index;
  this.draw();
};

List.prototype.previous = function() {
  this.move(this.active === 0 ? this.items.length - 1 : this.active - 1);
};

List.prototype.next = function() {
  this.move(this.active === this.items.length - 1 ? 0 : this.active + 1);
};

module.exports = List;

},{}],55:[function(require,module,exports){
'use strict';

var extend = require('xtend');
var fuzzy = require('fuzzy');
var List = require('./list');

var Suggestions = function(el, data, options) {
  options = options || {};

  this.options = extend({
    minLength: 2,
    limit: 5,
    filter: true
  }, options);

  this.el = el;
  this.data = data || [];
  this.list = new List(this);

  this.query = '';
  this.selected = null;

  this.list.draw();

  this.el.addEventListener('keyup', function(e) {
    this.handleKeyUp(e.keyCode);
  }.bind(this), false);

  this.el.addEventListener('keydown', function(e) {
    this.handleKeyDown(e);
  }.bind(this));

  this.el.addEventListener('focus', function() {
    this.handleFocus();
  }.bind(this));

  this.el.addEventListener('blur', function() {
    this.handleBlur();
  }.bind(this));

  this.el.addEventListener('paste', function(e) {
    this.handlePaste(e);
  }.bind(this));

  return this;
};

Suggestions.prototype.handleKeyUp = function(keyCode) {
  // 40 - DOWN
  // 38 - UP
  // 27 - ESC
  // 13 - ENTER
  // 9 - TAB

  if (keyCode === 40 ||
      keyCode === 38 ||
      keyCode === 27 ||
      keyCode === 13 ||
      keyCode === 9) return;

  this.handleInputChange(this.el.value);
};

Suggestions.prototype.handleKeyDown = function(e) {
  switch (e.keyCode) {
    case 13: // ENTER
    case 9:  // TAB
      e.preventDefault();
      if (!this.list.isEmpty()) {
        this.value(this.list.items[this.list.active].original);
        this.list.hide();
      }
    break;
    case 27: // ESC
      if (!this.list.isEmpty()) this.list.hide();
    break;
    case 38: // UP
      this.list.previous();
    break;
    case 40: // DOWN
      this.list.next();
    break;
  }
};

Suggestions.prototype.handleBlur = function() {
  if (!this.list.selectingListItem) {
    this.list.hide();
  }
};

Suggestions.prototype.handlePaste = function(e) {
  if (e.clipboardData) {
    this.handleInputChange(e.clipboardData.getData('Text'));
  } else {
    var self = this;
    setTimeout(function () {
      self.handleInputChange(e.target.value);
    }, 100);
  }
};

Suggestions.prototype.handleInputChange = function(query) {
  this.query = this.normalize(query);

  this.list.clear();

  if (this.query.length < this.options.minLength) {
    this.list.draw();
    return;
  }

  this.getCandidates(function(data) {
    for (var i = 0; i < data.length; i++) {
      this.list.add(data[i]);
      if (i === (this.options.limit - 1)) break;
    }
    this.list.draw();
  }.bind(this));
};

Suggestions.prototype.handleFocus = function() {
  if (!this.list.isEmpty()) this.list.show();
  this.list.selectingListItem = false;
};

/**
 * Update data previously passed
 *
 * @param {Array} revisedData
 */
Suggestions.prototype.update = function(revisedData) {
  this.data = revisedData;
  this.handleKeyUp();
};

/**
 * Clears data
 */
Suggestions.prototype.clear = function() {
  this.data = [];
  this.list.clear();
};

/**
 * Normalize the results list and input value for matching
 *
 * @param {String} value
 * @return {String}
 */
Suggestions.prototype.normalize = function(value) {
  value = value.toLowerCase();
  return value;
};

/**
 * Evaluates whether an array item qualifies as a match with the current query
 *
 * @param {String} candidate a possible item from the array passed
 * @param {String} query the current query
 * @return {Boolean}
 */
Suggestions.prototype.match = function(candidate, query) {
  return candidate.indexOf(query) > -1;
};

Suggestions.prototype.value = function(value) {
  this.selected = value;
  this.el.value = this.getItemValue(value);

  if (document.createEvent) {
    var e = document.createEvent('HTMLEvents');
    e.initEvent('change', true, false);
    this.el.dispatchEvent(e);
  } else {
    this.el.fireEvent('onchange');
  }
};

Suggestions.prototype.getCandidates = function(callback) {
  var options = {
    pre: '<strong>',
    post: '</strong>',
    extract: function(d) { return this.getItemValue(d); }.bind(this)
  };

  var results = this.options.filter ?
    fuzzy.filter(this.query, this.data, options) :
    this.data.map(function(d) {
      var boldString = this.getItemValue(d);
      var indexString = this.normalize(boldString);
      var indexOfQuery = indexString.lastIndexOf(this.query);
      while(indexOfQuery > -1) {
        var endIndexOfQuery = indexOfQuery + this.query.length;
        boldString = boldString.slice(0, indexOfQuery) + '<strong>' + boldString.slice(indexOfQuery, endIndexOfQuery) + '</strong>' + boldString.slice(endIndexOfQuery);
        indexOfQuery = indexString.slice(0, indexOfQuery).lastIndexOf(this.query);
      }
      return {
        original: d,
        string: boldString
      };
    }.bind(this));

  callback(results);
};

/**
 * For a given item in the data array, return what should be used as the candidate string
 *
 * @param {Object|String} item an item from the data array
 * @return {String} item
 */
Suggestions.prototype.getItemValue = function(item) {
  return item;
};

module.exports = Suggestions;

},{"./list":54,"fuzzy":7,"xtend":58}],56:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

var punycode = require('punycode');
var util = require('./util');

exports.parse = urlParse;
exports.resolve = urlResolve;
exports.resolveObject = urlResolveObject;
exports.format = urlFormat;

exports.Url = Url;

function Url() {
  this.protocol = null;
  this.slashes = null;
  this.auth = null;
  this.host = null;
  this.port = null;
  this.hostname = null;
  this.hash = null;
  this.search = null;
  this.query = null;
  this.pathname = null;
  this.path = null;
  this.href = null;
}

// Reference: RFC 3986, RFC 1808, RFC 2396

// define these here so at least they only have to be
// compiled once on the first module load.
var protocolPattern = /^([a-z0-9.+-]+:)/i,
    portPattern = /:[0-9]*$/,

    // Special case for a simple path URL
    simplePathPattern = /^(\/\/?(?!\/)[^\?\s]*)(\?[^\s]*)?$/,

    // RFC 2396: characters reserved for delimiting URLs.
    // We actually just auto-escape these.
    delims = ['<', '>', '"', '`', ' ', '\r', '\n', '\t'],

    // RFC 2396: characters not allowed for various reasons.
    unwise = ['{', '}', '|', '\\', '^', '`'].concat(delims),

    // Allowed by RFCs, but cause of XSS attacks.  Always escape these.
    autoEscape = ['\''].concat(unwise),
    // Characters that are never ever allowed in a hostname.
    // Note that any invalid chars are also handled, but these
    // are the ones that are *expected* to be seen, so we fast-path
    // them.
    nonHostChars = ['%', '/', '?', ';', '#'].concat(autoEscape),
    hostEndingChars = ['/', '?', '#'],
    hostnameMaxLen = 255,
    hostnamePartPattern = /^[+a-z0-9A-Z_-]{0,63}$/,
    hostnamePartStart = /^([+a-z0-9A-Z_-]{0,63})(.*)$/,
    // protocols that can allow "unsafe" and "unwise" chars.
    unsafeProtocol = {
      'javascript': true,
      'javascript:': true
    },
    // protocols that never have a hostname.
    hostlessProtocol = {
      'javascript': true,
      'javascript:': true
    },
    // protocols that always contain a // bit.
    slashedProtocol = {
      'http': true,
      'https': true,
      'ftp': true,
      'gopher': true,
      'file': true,
      'http:': true,
      'https:': true,
      'ftp:': true,
      'gopher:': true,
      'file:': true
    },
    querystring = require('querystring');

function urlParse(url, parseQueryString, slashesDenoteHost) {
  if (url && util.isObject(url) && url instanceof Url) return url;

  var u = new Url;
  u.parse(url, parseQueryString, slashesDenoteHost);
  return u;
}

Url.prototype.parse = function(url, parseQueryString, slashesDenoteHost) {
  if (!util.isString(url)) {
    throw new TypeError("Parameter 'url' must be a string, not " + typeof url);
  }

  // Copy chrome, IE, opera backslash-handling behavior.
  // Back slashes before the query string get converted to forward slashes
  // See: https://code.google.com/p/chromium/issues/detail?id=25916
  var queryIndex = url.indexOf('?'),
      splitter =
          (queryIndex !== -1 && queryIndex < url.indexOf('#')) ? '?' : '#',
      uSplit = url.split(splitter),
      slashRegex = /\\/g;
  uSplit[0] = uSplit[0].replace(slashRegex, '/');
  url = uSplit.join(splitter);

  var rest = url;

  // trim before proceeding.
  // This is to support parse stuff like "  http://foo.com  \n"
  rest = rest.trim();

  if (!slashesDenoteHost && url.split('#').length === 1) {
    // Try fast path regexp
    var simplePath = simplePathPattern.exec(rest);
    if (simplePath) {
      this.path = rest;
      this.href = rest;
      this.pathname = simplePath[1];
      if (simplePath[2]) {
        this.search = simplePath[2];
        if (parseQueryString) {
          this.query = querystring.parse(this.search.substr(1));
        } else {
          this.query = this.search.substr(1);
        }
      } else if (parseQueryString) {
        this.search = '';
        this.query = {};
      }
      return this;
    }
  }

  var proto = protocolPattern.exec(rest);
  if (proto) {
    proto = proto[0];
    var lowerProto = proto.toLowerCase();
    this.protocol = lowerProto;
    rest = rest.substr(proto.length);
  }

  // figure out if it's got a host
  // user@server is *always* interpreted as a hostname, and url
  // resolution will treat //foo/bar as host=foo,path=bar because that's
  // how the browser resolves relative URLs.
  if (slashesDenoteHost || proto || rest.match(/^\/\/[^@\/]+@[^@\/]+/)) {
    var slashes = rest.substr(0, 2) === '//';
    if (slashes && !(proto && hostlessProtocol[proto])) {
      rest = rest.substr(2);
      this.slashes = true;
    }
  }

  if (!hostlessProtocol[proto] &&
      (slashes || (proto && !slashedProtocol[proto]))) {

    // there's a hostname.
    // the first instance of /, ?, ;, or # ends the host.
    //
    // If there is an @ in the hostname, then non-host chars *are* allowed
    // to the left of the last @ sign, unless some host-ending character
    // comes *before* the @-sign.
    // URLs are obnoxious.
    //
    // ex:
    // http://a@b@c/ => user:a@b host:c
    // http://a@b?@c => user:a host:c path:/?@c

    // v0.12 TODO(isaacs): This is not quite how Chrome does things.
    // Review our test case against browsers more comprehensively.

    // find the first instance of any hostEndingChars
    var hostEnd = -1;
    for (var i = 0; i < hostEndingChars.length; i++) {
      var hec = rest.indexOf(hostEndingChars[i]);
      if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
        hostEnd = hec;
    }

    // at this point, either we have an explicit point where the
    // auth portion cannot go past, or the last @ char is the decider.
    var auth, atSign;
    if (hostEnd === -1) {
      // atSign can be anywhere.
      atSign = rest.lastIndexOf('@');
    } else {
      // atSign must be in auth portion.
      // http://a@b/c@d => host:b auth:a path:/c@d
      atSign = rest.lastIndexOf('@', hostEnd);
    }

    // Now we have a portion which is definitely the auth.
    // Pull that off.
    if (atSign !== -1) {
      auth = rest.slice(0, atSign);
      rest = rest.slice(atSign + 1);
      this.auth = decodeURIComponent(auth);
    }

    // the host is the remaining to the left of the first non-host char
    hostEnd = -1;
    for (var i = 0; i < nonHostChars.length; i++) {
      var hec = rest.indexOf(nonHostChars[i]);
      if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
        hostEnd = hec;
    }
    // if we still have not hit it, then the entire thing is a host.
    if (hostEnd === -1)
      hostEnd = rest.length;

    this.host = rest.slice(0, hostEnd);
    rest = rest.slice(hostEnd);

    // pull out port.
    this.parseHost();

    // we've indicated that there is a hostname,
    // so even if it's empty, it has to be present.
    this.hostname = this.hostname || '';

    // if hostname begins with [ and ends with ]
    // assume that it's an IPv6 address.
    var ipv6Hostname = this.hostname[0] === '[' &&
        this.hostname[this.hostname.length - 1] === ']';

    // validate a little.
    if (!ipv6Hostname) {
      var hostparts = this.hostname.split(/\./);
      for (var i = 0, l = hostparts.length; i < l; i++) {
        var part = hostparts[i];
        if (!part) continue;
        if (!part.match(hostnamePartPattern)) {
          var newpart = '';
          for (var j = 0, k = part.length; j < k; j++) {
            if (part.charCodeAt(j) > 127) {
              // we replace non-ASCII char with a temporary placeholder
              // we need this to make sure size of hostname is not
              // broken by replacing non-ASCII by nothing
              newpart += 'x';
            } else {
              newpart += part[j];
            }
          }
          // we test again with ASCII char only
          if (!newpart.match(hostnamePartPattern)) {
            var validParts = hostparts.slice(0, i);
            var notHost = hostparts.slice(i + 1);
            var bit = part.match(hostnamePartStart);
            if (bit) {
              validParts.push(bit[1]);
              notHost.unshift(bit[2]);
            }
            if (notHost.length) {
              rest = '/' + notHost.join('.') + rest;
            }
            this.hostname = validParts.join('.');
            break;
          }
        }
      }
    }

    if (this.hostname.length > hostnameMaxLen) {
      this.hostname = '';
    } else {
      // hostnames are always lower case.
      this.hostname = this.hostname.toLowerCase();
    }

    if (!ipv6Hostname) {
      // IDNA Support: Returns a punycoded representation of "domain".
      // It only converts parts of the domain name that
      // have non-ASCII characters, i.e. it doesn't matter if
      // you call it with a domain that already is ASCII-only.
      this.hostname = punycode.toASCII(this.hostname);
    }

    var p = this.port ? ':' + this.port : '';
    var h = this.hostname || '';
    this.host = h + p;
    this.href += this.host;

    // strip [ and ] from the hostname
    // the host field still retains them, though
    if (ipv6Hostname) {
      this.hostname = this.hostname.substr(1, this.hostname.length - 2);
      if (rest[0] !== '/') {
        rest = '/' + rest;
      }
    }
  }

  // now rest is set to the post-host stuff.
  // chop off any delim chars.
  if (!unsafeProtocol[lowerProto]) {

    // First, make 100% sure that any "autoEscape" chars get
    // escaped, even if encodeURIComponent doesn't think they
    // need to be.
    for (var i = 0, l = autoEscape.length; i < l; i++) {
      var ae = autoEscape[i];
      if (rest.indexOf(ae) === -1)
        continue;
      var esc = encodeURIComponent(ae);
      if (esc === ae) {
        esc = escape(ae);
      }
      rest = rest.split(ae).join(esc);
    }
  }


  // chop off from the tail first.
  var hash = rest.indexOf('#');
  if (hash !== -1) {
    // got a fragment string.
    this.hash = rest.substr(hash);
    rest = rest.slice(0, hash);
  }
  var qm = rest.indexOf('?');
  if (qm !== -1) {
    this.search = rest.substr(qm);
    this.query = rest.substr(qm + 1);
    if (parseQueryString) {
      this.query = querystring.parse(this.query);
    }
    rest = rest.slice(0, qm);
  } else if (parseQueryString) {
    // no query string, but parseQueryString still requested
    this.search = '';
    this.query = {};
  }
  if (rest) this.pathname = rest;
  if (slashedProtocol[lowerProto] &&
      this.hostname && !this.pathname) {
    this.pathname = '/';
  }

  //to support http.request
  if (this.pathname || this.search) {
    var p = this.pathname || '';
    var s = this.search || '';
    this.path = p + s;
  }

  // finally, reconstruct the href based on what has been validated.
  this.href = this.format();
  return this;
};

// format a parsed object into a url string
function urlFormat(obj) {
  // ensure it's an object, and not a string url.
  // If it's an obj, this is a no-op.
  // this way, you can call url_format() on strings
  // to clean up potentially wonky urls.
  if (util.isString(obj)) obj = urlParse(obj);
  if (!(obj instanceof Url)) return Url.prototype.format.call(obj);
  return obj.format();
}

Url.prototype.format = function() {
  var auth = this.auth || '';
  if (auth) {
    auth = encodeURIComponent(auth);
    auth = auth.replace(/%3A/i, ':');
    auth += '@';
  }

  var protocol = this.protocol || '',
      pathname = this.pathname || '',
      hash = this.hash || '',
      host = false,
      query = '';

  if (this.host) {
    host = auth + this.host;
  } else if (this.hostname) {
    host = auth + (this.hostname.indexOf(':') === -1 ?
        this.hostname :
        '[' + this.hostname + ']');
    if (this.port) {
      host += ':' + this.port;
    }
  }

  if (this.query &&
      util.isObject(this.query) &&
      Object.keys(this.query).length) {
    query = querystring.stringify(this.query);
  }

  var search = this.search || (query && ('?' + query)) || '';

  if (protocol && protocol.substr(-1) !== ':') protocol += ':';

  // only the slashedProtocols get the //.  Not mailto:, xmpp:, etc.
  // unless they had them to begin with.
  if (this.slashes ||
      (!protocol || slashedProtocol[protocol]) && host !== false) {
    host = '//' + (host || '');
    if (pathname && pathname.charAt(0) !== '/') pathname = '/' + pathname;
  } else if (!host) {
    host = '';
  }

  if (hash && hash.charAt(0) !== '#') hash = '#' + hash;
  if (search && search.charAt(0) !== '?') search = '?' + search;

  pathname = pathname.replace(/[?#]/g, function(match) {
    return encodeURIComponent(match);
  });
  search = search.replace('#', '%23');

  return protocol + host + pathname + search + hash;
};

function urlResolve(source, relative) {
  return urlParse(source, false, true).resolve(relative);
}

Url.prototype.resolve = function(relative) {
  return this.resolveObject(urlParse(relative, false, true)).format();
};

function urlResolveObject(source, relative) {
  if (!source) return relative;
  return urlParse(source, false, true).resolveObject(relative);
}

Url.prototype.resolveObject = function(relative) {
  if (util.isString(relative)) {
    var rel = new Url();
    rel.parse(relative, false, true);
    relative = rel;
  }

  var result = new Url();
  var tkeys = Object.keys(this);
  for (var tk = 0; tk < tkeys.length; tk++) {
    var tkey = tkeys[tk];
    result[tkey] = this[tkey];
  }

  // hash is always overridden, no matter what.
  // even href="" will remove it.
  result.hash = relative.hash;

  // if the relative url is empty, then there's nothing left to do here.
  if (relative.href === '') {
    result.href = result.format();
    return result;
  }

  // hrefs like //foo/bar always cut to the protocol.
  if (relative.slashes && !relative.protocol) {
    // take everything except the protocol from relative
    var rkeys = Object.keys(relative);
    for (var rk = 0; rk < rkeys.length; rk++) {
      var rkey = rkeys[rk];
      if (rkey !== 'protocol')
        result[rkey] = relative[rkey];
    }

    //urlParse appends trailing / to urls like http://www.example.com
    if (slashedProtocol[result.protocol] &&
        result.hostname && !result.pathname) {
      result.path = result.pathname = '/';
    }

    result.href = result.format();
    return result;
  }

  if (relative.protocol && relative.protocol !== result.protocol) {
    // if it's a known url protocol, then changing
    // the protocol does weird things
    // first, if it's not file:, then we MUST have a host,
    // and if there was a path
    // to begin with, then we MUST have a path.
    // if it is file:, then the host is dropped,
    // because that's known to be hostless.
    // anything else is assumed to be absolute.
    if (!slashedProtocol[relative.protocol]) {
      var keys = Object.keys(relative);
      for (var v = 0; v < keys.length; v++) {
        var k = keys[v];
        result[k] = relative[k];
      }
      result.href = result.format();
      return result;
    }

    result.protocol = relative.protocol;
    if (!relative.host && !hostlessProtocol[relative.protocol]) {
      var relPath = (relative.pathname || '').split('/');
      while (relPath.length && !(relative.host = relPath.shift()));
      if (!relative.host) relative.host = '';
      if (!relative.hostname) relative.hostname = '';
      if (relPath[0] !== '') relPath.unshift('');
      if (relPath.length < 2) relPath.unshift('');
      result.pathname = relPath.join('/');
    } else {
      result.pathname = relative.pathname;
    }
    result.search = relative.search;
    result.query = relative.query;
    result.host = relative.host || '';
    result.auth = relative.auth;
    result.hostname = relative.hostname || relative.host;
    result.port = relative.port;
    // to support http.request
    if (result.pathname || result.search) {
      var p = result.pathname || '';
      var s = result.search || '';
      result.path = p + s;
    }
    result.slashes = result.slashes || relative.slashes;
    result.href = result.format();
    return result;
  }

  var isSourceAbs = (result.pathname && result.pathname.charAt(0) === '/'),
      isRelAbs = (
          relative.host ||
          relative.pathname && relative.pathname.charAt(0) === '/'
      ),
      mustEndAbs = (isRelAbs || isSourceAbs ||
                    (result.host && relative.pathname)),
      removeAllDots = mustEndAbs,
      srcPath = result.pathname && result.pathname.split('/') || [],
      relPath = relative.pathname && relative.pathname.split('/') || [],
      psychotic = result.protocol && !slashedProtocol[result.protocol];

  // if the url is a non-slashed url, then relative
  // links like ../.. should be able
  // to crawl up to the hostname, as well.  This is strange.
  // result.protocol has already been set by now.
  // Later on, put the first path part into the host field.
  if (psychotic) {
    result.hostname = '';
    result.port = null;
    if (result.host) {
      if (srcPath[0] === '') srcPath[0] = result.host;
      else srcPath.unshift(result.host);
    }
    result.host = '';
    if (relative.protocol) {
      relative.hostname = null;
      relative.port = null;
      if (relative.host) {
        if (relPath[0] === '') relPath[0] = relative.host;
        else relPath.unshift(relative.host);
      }
      relative.host = null;
    }
    mustEndAbs = mustEndAbs && (relPath[0] === '' || srcPath[0] === '');
  }

  if (isRelAbs) {
    // it's absolute.
    result.host = (relative.host || relative.host === '') ?
                  relative.host : result.host;
    result.hostname = (relative.hostname || relative.hostname === '') ?
                      relative.hostname : result.hostname;
    result.search = relative.search;
    result.query = relative.query;
    srcPath = relPath;
    // fall through to the dot-handling below.
  } else if (relPath.length) {
    // it's relative
    // throw away the existing file, and take the new path instead.
    if (!srcPath) srcPath = [];
    srcPath.pop();
    srcPath = srcPath.concat(relPath);
    result.search = relative.search;
    result.query = relative.query;
  } else if (!util.isNullOrUndefined(relative.search)) {
    // just pull out the search.
    // like href='?foo'.
    // Put this after the other two cases because it simplifies the booleans
    if (psychotic) {
      result.hostname = result.host = srcPath.shift();
      //occationaly the auth can get stuck only in host
      //this especially happens in cases like
      //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
      var authInHost = result.host && result.host.indexOf('@') > 0 ?
                       result.host.split('@') : false;
      if (authInHost) {
        result.auth = authInHost.shift();
        result.host = result.hostname = authInHost.shift();
      }
    }
    result.search = relative.search;
    result.query = relative.query;
    //to support http.request
    if (!util.isNull(result.pathname) || !util.isNull(result.search)) {
      result.path = (result.pathname ? result.pathname : '') +
                    (result.search ? result.search : '');
    }
    result.href = result.format();
    return result;
  }

  if (!srcPath.length) {
    // no path at all.  easy.
    // we've already handled the other stuff above.
    result.pathname = null;
    //to support http.request
    if (result.search) {
      result.path = '/' + result.search;
    } else {
      result.path = null;
    }
    result.href = result.format();
    return result;
  }

  // if a url ENDs in . or .., then it must get a trailing slash.
  // however, if it ends in anything else non-slashy,
  // then it must NOT get a trailing slash.
  var last = srcPath.slice(-1)[0];
  var hasTrailingSlash = (
      (result.host || relative.host || srcPath.length > 1) &&
      (last === '.' || last === '..') || last === '');

  // strip single dots, resolve double dots to parent dir
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = srcPath.length; i >= 0; i--) {
    last = srcPath[i];
    if (last === '.') {
      srcPath.splice(i, 1);
    } else if (last === '..') {
      srcPath.splice(i, 1);
      up++;
    } else if (up) {
      srcPath.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (!mustEndAbs && !removeAllDots) {
    for (; up--; up) {
      srcPath.unshift('..');
    }
  }

  if (mustEndAbs && srcPath[0] !== '' &&
      (!srcPath[0] || srcPath[0].charAt(0) !== '/')) {
    srcPath.unshift('');
  }

  if (hasTrailingSlash && (srcPath.join('/').substr(-1) !== '/')) {
    srcPath.push('');
  }

  var isAbsolute = srcPath[0] === '' ||
      (srcPath[0] && srcPath[0].charAt(0) === '/');

  // put the host back
  if (psychotic) {
    result.hostname = result.host = isAbsolute ? '' :
                                    srcPath.length ? srcPath.shift() : '';
    //occationaly the auth can get stuck only in host
    //this especially happens in cases like
    //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
    var authInHost = result.host && result.host.indexOf('@') > 0 ?
                     result.host.split('@') : false;
    if (authInHost) {
      result.auth = authInHost.shift();
      result.host = result.hostname = authInHost.shift();
    }
  }

  mustEndAbs = mustEndAbs || (result.host && srcPath.length);

  if (mustEndAbs && !isAbsolute) {
    srcPath.unshift('');
  }

  if (!srcPath.length) {
    result.pathname = null;
    result.path = null;
  } else {
    result.pathname = srcPath.join('/');
  }

  //to support request.http
  if (!util.isNull(result.pathname) || !util.isNull(result.search)) {
    result.path = (result.pathname ? result.pathname : '') +
                  (result.search ? result.search : '');
  }
  result.auth = relative.auth || result.auth;
  result.slashes = result.slashes || relative.slashes;
  result.href = result.format();
  return result;
};

Url.prototype.parseHost = function() {
  var host = this.host;
  var port = portPattern.exec(host);
  if (port) {
    port = port[0];
    if (port !== ':') {
      this.port = port.substr(1);
    }
    host = host.substr(0, host.length - port.length);
  }
  if (host) this.hostname = host;
};

},{"./util":57,"punycode":21,"querystring":24}],57:[function(require,module,exports){
'use strict';

module.exports = {
  isString: function(arg) {
    return typeof(arg) === 'string';
  },
  isObject: function(arg) {
    return typeof(arg) === 'object' && arg !== null;
  },
  isNull: function(arg) {
    return arg === null;
  },
  isNullOrUndefined: function(arg) {
    return arg == null;
  }
};

},{}],58:[function(require,module,exports){
module.exports = extend

var hasOwnProperty = Object.prototype.hasOwnProperty;

function extend() {
    var target = {}

    for (var i = 0; i < arguments.length; i++) {
        var source = arguments[i]

        for (var key in source) {
            if (hasOwnProperty.call(source, key)) {
                target[key] = source[key]
            }
        }
    }

    return target
}

},{}],59:[function(require,module,exports){
const MapboxGeocoder = require('@mapbox/mapbox-gl-geocoder');
const mapboxgl = require('mapbox-gl');
const tilebelt = require('@mapbox/tilebelt');
const cover = require('@mapbox/tile-cover');

mapboxgl.accessToken = 'pk.eyJ1Ijoia3VhbmIiLCJhIjoidXdWUVZ2USJ9.qNKXXP6z9_fKA8qrmpOi6Q';

var map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/light-v10',
  center: [0, 25],
  zoom: 1.3
});

var geocoder = new MapboxGeocoder({
  accessToken: mapboxgl.accessToken
});

map.addControl(geocoder);

class QuadkeySearchControl {
    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl';
        this._container.innerHTML = `
          <form id='tilesearch' onsubmit="return false;" >
            <div id='tag'>QK</div>
            <input id='editable'></input>
          </form>
        `;
        return this._container;
    }

    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
}

var quadkeySearchControl = new QuadkeySearchControl();

map.addControl(quadkeySearchControl, 'top-left');

map.on('load', () => {
  map.addSource('tiles-geojson', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: []
    }
  });

  map.addSource('tiles-centers-geojson', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: []
    }
  });

  map.addLayer({
    id: 'tiles',
    source: 'tiles-geojson',
    type: 'line',
    paint: {
      'line-color': '#000'
    }
  });

  map.addLayer({
    id: 'tiles-shade',
    source: 'tiles-geojson',
    type: 'fill',
    paint: {
      'fill-color': ['case', ['get', 'even'], 'rgba(0,0,0,0.1)', 'rgba(0,0,0,0)']
    }
  });

  map.addLayer({
    id: 'tiles-centers',
    source: 'tiles-centers-geojson',
    type: 'symbol',
    layout: {
      'text-field': ['format', ['get', 'text'], { 'font-scale': 1.2 }],
      'text-offset': [0, -1],
    },
    paint: {
      'text-color': '#000',
      'text-color-transition': {
        duration: 0
      },
      'text-halo-color': '#fff',
      'text-halo-width': 0.5
    }
  });

  update();
});

map.on('moveend', update);

map.on('click', (e) => {
  features = map.queryRenderedFeatures(e.point, {layers: ['tiles-shade']});
  copyToClipboard(features[0].properties.quadkey)
  showSnackbar()
})

function updateGeocoderProximity() {
  // proximity is designed for local scale, if the user is looking at the whole world,
  // it doesn't make sense to factor in the arbitrary centre of the map
  if (map.getZoom() > 9) {
    var center = map.getCenter().wrap(); // ensures the longitude falls within -180 to 180 as the Geocoding API doesn't accept values outside this range
    geocoder.setProximity({ longitude: center.lng, latitude: center.lat });
  } else {
    geocoder.setProximity(null);
  }
}

function update() {
  updateGeocoderProximity();
  updateTiles();
}

function updateTiles() {
  var extentsGeom = getExtentsGeom();
  var zoom = Math.ceil(map.getZoom());
  var qkQuery = getQuadKeyQueryString();
  var targetZoom = qkQuery && qkQuery.length ? qkQuery.length : zoom;
  tiles = cover.tiles(extentsGeom, {min_zoom: targetZoom, max_zoom: targetZoom});

  map.getSource('tiles-geojson').setData({
    type: 'FeatureCollection',
    features: tiles.map(getTileFeature)
  });

  map.getSource('tiles-centers-geojson').setData({
    type: 'FeatureCollection',
    features: tiles.map(getTileCenterFeature)
  });
}

function getExtentsGeom() {
  var e = map.getBounds();
  var box = [
    e.getSouthWest().toArray(),
    e.getNorthWest().toArray(),
    e.getNorthEast().toArray(),
    e.getSouthEast().toArray(),
    e.getSouthWest().toArray()
  ].map(coords => {
    if (coords[0] < -180) return [-179.99999, coords[1]]
    if (coords[0] > 180) return [179.99999, coords[1]]
    return coords
  });

  return {
    type: 'Polygon',
    coordinates: [box]
  };
}

function getQuadKeyQueryString() {
  try {
    return document.getElementById('editable').value.toString();
  } catch (e) {
    // TODO: handle edge case?
    console.log(e);
  }
}

// bind op to search button, top left
document.getElementById('tilesearch').onsubmit = function navToQuadkey(e) {
  e.preventDefault();
  try {
    // convert qk to a tile to leverage helper func
    const qkGeo = tilebelt.tileToGeoJSON(
      tilebelt.quadkeyToTile(getQuadKeyQueryString()));

    // move map viewport around the new tile
    map.fitBounds([qkGeo.coordinates[0][0], qkGeo.coordinates[0][2]]);

  } catch (e) {
    // TODO: make a new version of snackbar that says "bad quadkey"
    console.log(e);
  }
};

function getTileFeature(tile) {
  var quadkey = tilebelt.tileToQuadkey(tile);

  var feature = {
    type: 'Feature',
    properties: {
      even: ((tile[0] + tile[1]) % 2 == 0),
      quadkey: quadkey
    },
    geometry: tilebelt.tileToGeoJSON(tile)
  };
  return feature;
}

function getTileCenterFeature(tile) {
  var box = tilebelt.tileToBBOX(tile);
  var center = [
    (box[0] + box[2]) / 2,
    (box[1] + box[3]) / 2
  ];

  var quadkey = tilebelt.tileToQuadkey(tile);
  var tileArea = turf.area(tilebelt.tileToGeoJSON(tile)); // area in sq meters

  return {
    type: 'Feature',
    properties: {
      text: (
        'Tile: ' + JSON.stringify(tile) +
        '\nQuadkey: ' + quadkey +
        '\nZoom: ' + tile[2] +
        '\nArea: ' + Math.round(tileArea  / (1000**2)).toLocaleString() + ' sq. km'),
      quadkey: quadkey
    },
    geometry: {
      type: 'Point',
      coordinates: center
    }
  };
}

function copyToClipboard(str) {
  const el = document.createElement('textarea');
  el.value = str;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}


function showSnackbar() {
    var x = document.getElementById('snackbar');
    x.className = 'show';
    setTimeout(function(){ x.className = x.className.replace('show', ''); }, 2000);
}

},{"@mapbox/mapbox-gl-geocoder":2,"@mapbox/tile-cover":3,"@mapbox/tilebelt":4,"mapbox-gl":9}]},{},[59]);
