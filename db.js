/* MeasureMate — db.js
   IndexedDB wrapper. Database: measuremate-db v1.
   Stores: measurements (keyPath id), locations (keyPath id).
   No demo or seeded records: both stores start empty. */
(function () {
  'use strict';

  var DB_NAME = 'measuremate-db';
  var DB_VERSION = 1;

  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('measurements')) {
          db.createObjectStore('measurements', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('locations')) {
          db.createObjectStore('locations', { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
      req.onblocked = function () { reject(new Error('IndexedDB open blocked')); };
    });
    return dbPromise;
  }

  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('Transaction failed')); };
      tx.onabort = function () { reject(tx.error || new Error('Transaction aborted')); };
    });
  }

  function requestResult(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Request failed')); };
    });
  }

  async function getAll(storeName) {
    var db = await openDB();
    var tx = db.transaction(storeName, 'readonly');
    var result = await requestResult(tx.objectStore(storeName).getAll());
    return result || [];
  }

  async function put(storeName, record) {
    var db = await openDB();
    var tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(record);
    await txDone(tx);
  }

  async function remove(storeName, id) {
    var db = await openDB();
    var tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    await txDone(tx);
  }

  /* Atomic replace of both stores: used by validated backup import.
     The caller must validate the full payload first; this writes it in a
     single transaction so a failure leaves the old data untouched. */
  async function replaceAll(locations, measurements) {
    var db = await openDB();
    var tx = db.transaction(['locations', 'measurements'], 'readwrite');
    var locStore = tx.objectStore('locations');
    var meaStore = tx.objectStore('measurements');
    locStore.clear();
    meaStore.clear();
    locations.forEach(function (loc) { locStore.add(loc); });
    measurements.forEach(function (m) { meaStore.add(m); });
    await txDone(tx);
  }

  async function clearAll() {
    var db = await openDB();
    var tx = db.transaction(['locations', 'measurements'], 'readwrite');
    tx.objectStore('locations').clear();
    tx.objectStore('measurements').clear();
    await txDone(tx);
  }

  window.MeasureMateDB = {
    openDB: openDB,
    getAllMeasurements: function () { return getAll('measurements'); },
    getAllLocations: function () { return getAll('locations'); },
    putMeasurement: function (m) { return put('measurements', m); },
    deleteMeasurement: function (id) { return remove('measurements', id); },
    putLocation: function (loc) { return put('locations', loc); },
    deleteLocation: function (id) { return remove('locations', id); },
    replaceAll: replaceAll,
    clearAll: clearAll
  };
})();
