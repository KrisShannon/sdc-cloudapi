/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var test = require('tape').test;
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var util = require('util');
var common = require('./common');



// --- Globals

var client, server;


// --- Helpers

function checkOk(t, err, req, res, body) {
    t.ifError(err);
    t.ok(req);
    t.ok(res);
    common.checkHeaders(t, res.headers);
    t.ok(body);
    t.equal(body.login, client.testUser);
    t.equal(body.email, client.testUser);
    t.ok(body.id);
    t.ok(body.created);
    t.ok(body.updated);
    t.equal(res.statusCode, 200);
}



// --- Tests

test('setup', function (t) {
    common.setup(function (err, _client, _server) {
        t.ifError(err);
        t.ok(_client);
        client = _client;
        server = _server;

        t.end();
    });
});


test('GetAccount(my) OK', function (t) {
    client.get('/my', function (err, req, res, obj) {
        checkOk(t, err, req, res, obj);
        t.end();
    });
});


test('GetAccount(:login) OK', function (t) {
    var path = '/' + encodeURIComponent(client.testUser);
    client.get(path, function (err, req, res, obj) {
        checkOk(t, err, req, res, obj);
        t.end();
    });
});


test('GetAccount 403', function (t) {
    client.get('/admin', function (err) {
        t.ok(err);
        t.equal(err.statusCode, 403);
        t.equal(err.restCode, 'NotAuthorized');
        t.ok(err.message);
        t.end();
    });
});


test('GetAccount 404', function (t) {
    client.get('/' + uuid(), function (err) {
        t.ok(err);
        t.equal(err.statusCode, 404);
        t.equal(err.restCode, 'ResourceNotFound');
        t.end();
    });
});


test('PostAccount', function (t) {
    var path = '/' + encodeURIComponent(client.testUser);
    client.post(path, {
        givenName: 'James',
        sn: 'Bond',
        cn: 'James Bond',
        company: 'liltingly, Inc.',
        address: '6165 pyrophyllite Street',
        city: 'benzoylation concoctive',
        state: 'SP',
        postalCode: '4967',
        country: 'BAT',
        phone: '+1 891 657 5818'
    }, function (err, req, res, obj) {
        t.ifError(err);
        checkOk(t, err, req, res, obj);
        t.ok(obj.companyName);
        t.ok(obj.firstName);
        t.ok(obj.lastName);
        t.ok(obj.postalCode);
        t.ok(obj.city);
        t.ok(obj.state);
        t.ok(obj.country);
        t.ok(obj.phone);
        t.end();
    });
});


test('teardown', function (t) {
    common.teardown(client, server, function () {
        t.end();
    });
});
