/*
 Copyright (c) 2013 Gildas Lormeau. All rights reserved.

 Redistribution and use in source and binary forms, with or without
 modification, are permitted provided that the following conditions are met:

 1. Redistributions of source code must retain the above copyright notice,
 this list of conditions and the following disclaimer.

 2. Redistributions in binary form must reproduce the above copyright
 notice, this list of conditions and the following disclaimer in
 the documentation and/or other materials provided with the distribution.

 3. The names of the authors may not be used to endorse or promote products
 derived from this software without specific prior written permission.

 THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESSED OR IMPLIED WARRANTIES,
 INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
 FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL JCRAFT,
 INC. OR ANY CONTRIBUTORS TO THIS SOFTWARE BE LIABLE FOR ANY DIRECT, INDIRECT,
 INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA,
 OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
 EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

(function() {
	"use strict";

	var ERR_HTTP_RANGE = "HTTP Range not supported.";

	var Reader = zip.Reader;
	var Writer = zip.Writer;
	
	var ZipDirectoryEntry;

	var appendABViewSupported;
	try {
		appendABViewSupported = new Blob([ new DataView(new ArrayBuffer(0)) ]).size === 0;
	} catch (e) {
	}

	function HttpReader(url) {
		var that = this;

		function getData(callback, onerror) {
			var request;
			if (!that.data) {
				request = new XMLHttpRequest();
				request.addEventListener("load", function() {
					if (!that.size)
						that.size = Number(request.getResponseHeader("Content-Length"));
					that.data = new Uint8Array(request.response);
					callback();
				}, false);
				request.addEventListener("error", onerror, false);
				request.open("GET", url);
				request.responseType = "arraybuffer";
				request.send();
			} else
				callback();
		}

		function init(callback, onerror) {
			var request = new XMLHttpRequest();
			request.addEventListener("load", function() {
				that.size = Number(request.getResponseHeader("Content-Length"));
				callback();
			}, false);
			request.addEventListener("error", onerror, false);
			request.open("HEAD", url);
			request.send();
		}

		function readUint8Array(index, length, callback, onerror) {
			getData(function() {
				callback(new Uint8Array(that.data.subarray(index, index + length)));
			}, onerror);
		}

		that.size = 0;
		that.init = init;
		that.readUint8Array = readUint8Array;
	}
	HttpReader.prototype = new Reader();
	HttpReader.prototype.constructor = HttpReader;

	function HttpRangeReader(url) {
		var that = this;

		function init(callback, onerror) {
			var request = new XMLHttpRequest();
			request.addEventListener("load", function() {
				that.size = Number(request.getResponseHeader("Content-Length"));
				if (request.getResponseHeader("Accept-Ranges") == "bytes")
					callback();
				else
					onerror(ERR_HTTP_RANGE);
			}, false);
			request.addEventListener("error", onerror, false);
			request.open("HEAD", url);
			request.send();
		}

		function readArrayBuffer(index, length, callback, onerror) {
			var request = new XMLHttpRequest();
			request.open("GET", url);
			request.responseType = "arraybuffer";
			request.setRequestHeader("Range", "bytes=" + index + "-" + (index + length - 1));
			request.addEventListener("load", function() {
				callback(request.response);
			}, false);
			request.addEventListener("error", onerror, false);
			request.send();
		}

		function readUint8Array(index, length, callback, onerror) {
			readArrayBuffer(index, length, function(arraybuffer) {
				callback(new Uint8Array(arraybuffer));
			}, onerror);
		}

		that.size = 0;
		that.init = init;
		that.readUint8Array = readUint8Array;
	}
	HttpRangeReader.prototype = new Reader();
	HttpRangeReader.prototype.constructor = HttpRangeReader;

	function ArrayBufferReader(arrayBuffer) {
		var that = this;

		function init(callback, onerror) {
			that.size = arrayBuffer.byteLength;
			callback();
		}

		function readUint8Array(index, length, callback, onerror) {
			callback(new Uint8Array(arrayBuffer.slice(index, index + length)));
		}

		that.size = 0;
		that.init = init;
		that.readUint8Array = readUint8Array;
	}
	ArrayBufferReader.prototype = new Reader();
	ArrayBufferReader.prototype.constructor = ArrayBufferReader;

	function ArrayBufferWriter() {
		var array, that = this;

		function init(callback, onerror) {
			array = new Uint8Array();
			callback();
		}

		function writeUint8Array(arr, callback, onerror) {
			var tmpArray = new Uint8Array(array.length + arr.length);
			tmpArray.set(array);
			tmpArray.set(arr, array.length);
			array = tmpArray;
			callback();
		}

		function getData(callback) {
			callback(array.buffer);
		}

		that.init = init;
		that.writeUint8Array = writeUint8Array;
		that.getData = getData;
	}
	ArrayBufferWriter.prototype = new Writer();
	ArrayBufferWriter.prototype.constructor = ArrayBufferWriter;

	function FileWriter(fileEntry, contentType) {
		var writer, that = this;

		function init(callback, onerror) {
			fileEntry.createWriter(function(fileWriter) {
				writer = fileWriter;
				callback();
			}, onerror);
		}

		function writeUint8Array(array, callback, onerror) {
			var blob = new Blob([ appendABViewSupported ? array : array.buffer ], {
				type : contentType
			});
			writer.onwrite = function() {
				writer.onwrite = null;
				callback();
			};
			writer.onerror = onerror;
			writer.write(blob);
		}

		function getData(callback) {
			fileEntry.file(callback);
		}

		that.init = init;
		that.writeUint8Array = writeUint8Array;
		that.getData = getData;
	}
	FileWriter.prototype = new Writer();
	FileWriter.prototype.constructor = FileWriter;

	function DBWriter(contentType) {
		var db, tempDB, that = this, blobs, dbName = "zipjs", instance;

		function init(callback, onerror) {
			var request = indexedDB.open(dbName, 5);
			request.onerror = onerror;
			request.onupgradeneeded = function (event) {
				db = event.target.result;
				db.createObjectStore("instances", { autoIncrement: true });
			};
			request.onsuccess = function (event) {
				db = event.target.result;
				addInstance(callback, onerror);
			};
			blobs = [];
		}

		function addInstance(callback, onerror) {
			var t = db.transaction(["instances"], "readwrite"),
				request = t.objectStore("instances").put(Date.now());
			request.onerror = onerror;
			request.onsuccess = function (event) {
				instance = request.result;
				console.log("Current instance " + instance);
				cleanUpOldInstances();
				window.addEventListener("storage", pongDB);
				window.addEventListener("unload", close);
				addInstanceDB(callback, onerror);
			};
		}

		function addInstanceDB(callback, onerror) {
			var request = indexedDB.open(dbName + "_" + instance);
			request.onerror = onerror;
			request.onupgradeneeded = function (event) {
				tempDB = event.target.result;
				tempDB.createObjectStore("files", { autoIncrement: true });
			};
			request.onsuccess = function (event) {
				callback();
			};
		}

		function close() {
			blobs = [];
			indexedDB.deleteDatabase(dbName + "_" + instance);
		}

		function broadcastPingDB() {
			localStorage.zipjs = Date.now();
		}

		function pongDB(event) {
			if ((event !== undefined && event.key === "zipjs") && instance) {
				console.log("Pong from instance " + instance);
				db.transaction(["instances"], "readwrite")
								.objectStore("instances")
								.put(Date.now(), instance);
			}
		}

		function cleanUpOldInstances() {
			broadcastPingDB();
			pongDB();
			setTimeout(function () {
				findOldInstances(10000);
			}, 5000);
		}

		function findOldInstances(maxAge) {
			var t = db.transaction(["instances"], "readwrite"),
				instances = t.objectStore("instances"),
				expiration = Date.now() - maxAge,
				oldInstances = [];

			instances.openCursor().onsuccess = function (event) {
				var cursor = event.target.result;
				if (cursor) {
					if (cursor.value < expiration) {
						oldInstances.push(cursor.key);
						cursor.delete();
					}
					cursor.continue();
				} else {
					deleteOldInstances(oldInstances);
				}
			};

			t.onerror = onerror;
		}

		function deleteOldInstances(oldInstances) {
			var index = 0;

			for (var i = 0; i < oldInstances.length; i++) {
				indexedDB.deleteDatabase(dbName + "_" + oldInstances[i]);
			}
		}

		function makeDBBackedBlob(blob, callback, onerror) {
			function putEntry(blob) {
				var t = tempDB.transaction(["files"], "readwrite"),
					objectStore, request;
				t.oncomplete = function () {
					console.log("Make backed");
				};
				t.onerror = onerror;
				objectStore = t.objectStore("files");
				request = objectStore.put({instance: instance, data: blob});
				request.onsuccess = function (event) {
					getEntry(request.result);
				};
			}

			function getEntry(key) {
				var t = tempDB.transaction(["files"], "readonly"),
					objectStore, request;
				t.onerror = onerror;
				objectStore = t.objectStore("files");
				request = objectStore.get(key);
				request.onsuccess = function (event) {
					callback(request.result.data);
				};
			}

			putEntry(blob);
		}


		function writeUint8Array(array, callback, onerror) {
			var blob = new Blob([ appendABViewSupported ? array : array.buffer ]);

			makeDBBackedBlob(blob, function (storedBlob) {
					blobs.push(storedBlob);
					callback();
				}, onerror);
		}

		function getData(callback) {
			var concatBlob = new Blob(blobs, {type: contentType});
			callback(concatBlob);
		}

		that.init = init;
		that.writeUint8Array = writeUint8Array;
		that.getData = getData;
	}
	DBWriter.prototype = new Writer();
	DBWriter.prototype.constructor = FileWriter;

	zip.FileWriter = FileWriter;
	zip.HttpReader = HttpReader;
	zip.HttpRangeReader = HttpRangeReader;
	zip.ArrayBufferReader = ArrayBufferReader;
	zip.ArrayBufferWriter = ArrayBufferWriter;
	zip.DBWriter = DBWriter;

	if (zip.fs) {
		ZipDirectoryEntry = zip.fs.ZipDirectoryEntry;
		ZipDirectoryEntry.prototype.addHttpContent = function(name, URL, useRangeHeader) {
			function addChild(parent, name, params, directory) {
				if (parent.directory)
					return directory ? new ZipDirectoryEntry(parent.fs, name, params, parent) : new zip.fs.ZipFileEntry(parent.fs, name, params, parent);
				else
					throw "Parent entry is not a directory.";
			}

			return addChild(this, name, {
				data : URL,
				Reader : useRangeHeader ? HttpRangeReader : HttpReader
			});
		};
		ZipDirectoryEntry.prototype.importHttpContent = function(URL, useRangeHeader, onend, onerror) {
			this.importZip(useRangeHeader ? new HttpRangeReader(URL) : new HttpReader(URL), onend, onerror);
		};
		zip.fs.FS.prototype.importHttpContent = function(URL, useRangeHeader, onend, onerror) {
			this.entries = [];
			this.root = new ZipDirectoryEntry(this);
			this.root.importHttpContent(URL, useRangeHeader, onend, onerror);
		};
	}

})();
