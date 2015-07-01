/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var util = require('util');
var fs = require('fs');
var crypto = require('crypto');
var Keyapi = require('keyapi');
var qs = require('querystring');

var test = require('tape').test;
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var restify = require('restify');

var common = require('./common'),
    checkMahiCache = common.checkMahiCache,
    waitForMahiCache = common.waitForMahiCache;

var vasync = require('vasync');

// --- Globals

var SIGNATURE = 'Signature keyId="%s",algorithm="%s" %s';
var client, server, account;
var KEY_ID, SUB_KEY_ID;
var privateKey, publicKey;
var subPrivateKey, subPublicKey;

var USER_FMT = 'uuid=%s, ou=users, o=smartdc';
var POLICY_FMT = 'policy-uuid=%s, ' + USER_FMT;
var ROLE_FMT = 'role-uuid=%s, ' + USER_FMT;
var A_POLICY_NAME;
var A_ROLE_NAME;

// --- Tests

test('setup', function (t) {
    common.setup(function (err, _client, _server) {
        t.ifError(err);
        t.ok(_client);

        client = _client;
        server = _server;

        privateKey = client.privateKey;
        publicKey = client.publicKey;
        subPublicKey = client.subPublicKey;
        subPrivateKey = client.subPrivateKey;
        account = client.account.login;
        KEY_ID = client.KEY_ID;
        SUB_KEY_ID = client.SUB_ID;
        A_ROLE_NAME = client.role.name;
        A_POLICY_NAME = client.policy.name;

        t.end();
    });
});


test('basic auth (accept-version: ~6.5)', function (t) {
    var user = client.testUser;
    var pwd = 'secret123';
    var cli = restify.createJsonClient({
        url: server ? server.url : 'https://127.0.0.1',
        version: '*',
        retryOptions: {
            retry: 0
        },
        log: client.log,
        rejectUnauthorized: false
    });

    cli.basicAuth(user, pwd);

    cli.get({
        path: '/my',
        headers: {
            'accept-version': '~6.5'
        }
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.ok(obj);
        t.equal(obj.login, user);
        cli.close();
        t.end();
    });
});


test('basic auth (x-api-version: ~6.5)', function (t) {
    var user = client.testUser;
    var pwd = 'secret123';
    var cli = restify.createJsonClient({
        url: server ? server.url : 'https://127.0.0.1',
        retryOptions: {
            retry: 0
        },
        log: client.log,
        rejectUnauthorized: false
    });

    cli.basicAuth(user, pwd);

    cli.get({
        path: '/my',
        headers: {
            'x-api-version': '~6.5'
        }
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.ok(obj);
        t.equal(obj.login, user);
        cli.close();
        t.end();
    });
});


test('basic auth (accept-version: ~7.0)', function (t) {
    var user = client.testUser;
    var pwd = 'secret123';
    var cli = restify.createJsonClient({
        url: server ? server.url : 'https://127.0.0.1',
        retryOptions: {
            retry: 0
        },
        log: client.log,
        rejectUnauthorized: false
    });

    cli.basicAuth(user, pwd);

    cli.get({
        path: '/my',
        headers: {
            'accept-version': '~7.0'
        }
    }, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 401);
        t.ok(/authorization scheme/.test(err.message));
        cli.close();
        t.end();
    });
});


test('admin basic auth (x-api-version: ~6.5)', function (t) {
    var user = 'admin';
    var pwd = 'joypass123';
    var cli = restify.createJsonClient({
        url: server ? server.url : 'https://127.0.0.1',
        retryOptions: {
            retry: 0
        },
        log: client.log,
        rejectUnauthorized: false
    });

    cli.basicAuth(user, pwd);

    cli.get({
        path: '/' + client.testUser,
        headers: {
            'x-api-version': '~6.5'
        }
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.ok(obj);
        t.equal(obj.login, client.testUser);
        cli.close();
        t.end();
    });
});


test('signature auth', function (t) {
    client.get('/my/keys', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(/Signature/.test(req._headers.authorization));
        t.ok(body);
        t.ok(Array.isArray(body));
        t.ok(body.length);
        t.end();
    });
});


// http-signature 0.10.x test
var httpSignature = require('http-signature');
function requestSigner(req) {
    httpSignature.sign(req, {
        key: privateKey,
        keyId: KEY_ID
    });
}

test('signature auth (http-signature 0.10.x)', function (t) {
    var cli = restify.createJsonClient({
        url: server ? server.url : 'https://127.0.0.1',
        retryOptions: {
            retry: 0
        },
        log: client.log,
        rejectUnauthorized: false,
        signRequest: requestSigner
    });

    cli.get({
        path: '/my/keys',
        headers: {
            'accept-version': '~7.1'
        }
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(/Signature/.test(req._headers.authorization));
        t.ok(obj);
        t.ok(Array.isArray(obj));
        t.ok(obj.length);
        cli.close();
        t.end();
    });
});



test('token auth', function (t) {
    var config = common.getCfg();
    var keyapi = new Keyapi({ log: config.log, ufds: config.ufds });

    var now = new Date().toUTCString();
    var alg = 'RSA-SHA256';

    var signer = crypto.createSign(alg);
    signer.update(now);

    var authorization = util.format(SIGNATURE, KEY_ID, alg.toLowerCase(),
                                    signer.sign(privateKey, 'base64'));

    var sigClient = restify.createJsonClient({
        url: server ? server.url : 'https://127.0.0.1',
        version: '*',
        retryOptions: {
            retry: 0
        },
        log: client.log,
        rejectUnauthorized: false
    });

    function generateRequest(token) {
        return {
            path: '/admin/keys',
            headers: {
                // do not change case of 'date'; some versions of restify won't
                // override the date then, and sporadic failures occur
                date: now,
                'x-auth-token': JSON.stringify(token),
                'x-api-version': '~6.5',
                authorization: authorization
            }
        };
    }

    function callWithBadDetails(_t, details) {
        keyapi.token(details, function (err, token) {
            _t.ifError(err);

            var obj = generateRequest(token);

            sigClient.get(obj, function (err2, req, res, body) {
                _t.ok(err2);
                _t.deepEqual(body, {
                    code: 'InvalidCredentials',
                    message: 'The token provided is not authorized for this ' +
                            'application'
                });

                _t.end();
            });
        });
    }

    t.test('token with empty details', function (t2) {
        callWithBadDetails(t2, {});
    });

    t.test('token with wrong permission path', function (t2) {
        var tokenDetails = {
            account: client.account,
            devkeyId: KEY_ID,
            permissions: { cloudapi: ['/admin/other_things'] },
            expires: new Date(+new Date() + 1000).toISOString()
        };

        callWithBadDetails(t2, tokenDetails);
    });

    t.test('token with wrong expires', function (t2) {
        var tokenDetails = {
            account: client.account,
            devkeyId: KEY_ID,
            permissions: { cloudapi: ['/admin/keys'] },
            expires: new Date(+new Date() - 1).toISOString()
        };

        callWithBadDetails(t2, tokenDetails);
    });

    t.test('token with wrong devkeyId', function (t2) {
        var tokenDetails = {
            account: client.account,
            devkeyId: '/verybadkey@joyent.com/keys/id_rsa',
            permissions: { cloudapi: ['/admin/keys'] },
            expires: new Date(+new Date() + 1000).toISOString()
        };

        callWithBadDetails(t2, tokenDetails);
    });

    t.test('token auth response', function (t2) {
        var tokenDetails = {
            account: client.account,
            devkeyId: KEY_ID,
            permissions: { cloudapi: ['/admin/keys'] },
            expires: new Date(+new Date() + 1000).toISOString()
        };

        keyapi.token(tokenDetails, function (err, token) {
            t2.ifError(err);

            var obj = generateRequest(token);

            sigClient.get(obj, function (er1, req, res, body) {
                t2.ifError(er1, 'Token client error');
                t2.equal(res.statusCode, 200, 'Token client status code');
                common.checkHeaders(t2, res.headers);
                t2.ok(/Signature/.test(req._headers.authorization), 'Sig');
                t2.ok(body, 'Token body');
                t2.ok(Array.isArray(body), 'Token body is array');
                // This is admin user, which always has keys
                t2.ok(body.length, 'Admin has keys');

                sigClient.close();
                t2.end();
            });
        });
    });

    t.end();
});


// We need to create a new user here, because the ufds entries cached
// inside cloudapi conflict with simple updates of the existing user. That
// implies skipping using the existing http client.
test('auth of disabled account', function (t) {
    function attemptGet(err, tmpAccount, cb) {
        t.ifError(err);

        var httpClient = restify.createJsonClient({
            url: client.url.href, // grab from old client
            retryOptions: { retry: 0 },
            log: client.log,
            rejectUnauthorized: false
        });

        // cheating a bit by using the old auth method to make things easier
        httpClient.basicAuth(tmpAccount.login, tmpAccount.passwd);

        httpClient.get({
            path: '/my',
            headers: {
                'accept-version': '~6.5'
            }
        }, function (err2, req, res, body) {
            t.ok(err2);

            t.deepEqual(body, {
                code: 'NotAuthorized',
                message: 'Account or user is disabled'
            });

            httpClient.close();

            cb();
        });
    }

    function done() {
        t.end();
    }

    var opts = {
        disabled: true
    };

    common.withTemporaryUser(client.ufds, opts, attemptGet, done);
});


// Account sub-users will use only http-signature >= 0.10.x, given this
// feature has been added after moving from 0.9.
// Also, request version will always be >= 7.2 here.
test('tag resource collection with role', function (t) {
    client.put('/my/users', {
        'role-tag': [A_ROLE_NAME]
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body.name, 'resource role name');
        t.ok(body['role-tag'], 'resource role tag');
        t.ok(body['role-tag'].length, 'resource role tag ary');
        t.end();
    });
});


test('tag resource collection with non-existent role', function (t) {
    client.put('/my/users', {
        'role-tag': ['asdasdasdasd']
    }, function (err, req, res, body) {
        t.deepEqual(err, {
            message: 'Role(s) asdasdasdasd not found',
            statusCode: 409,
            restCode: 'InvalidArgument',
            name: 'InvalidArgumentError',
            body: {
                code: 'InvalidArgument',
                message: 'Role(s) asdasdasdasd not found'
            }
        });
        t.end();
    });
});


test('get resource collection role-tag', function (t) {
    var p = '/my/users';
    client.get({
        path: p
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body[0].login, 'resource is a user');
        t.ok(res.headers['role-tag'], 'resource role-tag header');
        t.equal(res.headers['role-tag'], A_ROLE_NAME, 'resource role-tag');
        t.end();
    });
});


test('tag individual resource with role', function (t) {
    client.put('/my/users/' + client.testSubUser, {
        'role-tag': [A_ROLE_NAME]
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body.name, 'resource role name');
        t.ok(body['role-tag'], 'resource role tag');
        t.ok(body['role-tag'].length, 'resource role tag ary');
        t.end();
    });
});


test('tag individual resource with non-existent role', function (t) {
    client.put('/my/users/' + client.testSubUser, {
        'role-tag': ['asdasdasdasd']
    }, function (err, req, res, body) {
        t.deepEqual(err, {
            message: 'Role(s) asdasdasdasd not found',
            statusCode: 409,
            restCode: 'InvalidArgument',
            name: 'InvalidArgumentError',
            body: {
                code: 'InvalidArgument',
                message: 'Role(s) asdasdasdasd not found'
            }
        });
        t.end();
    });
});


test('get individual resource role-tag', function (t) {
    var p = '/my/users/' + client.testSubUser;
    client.get({
        path: p
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body.login, 'resource is a user');
        t.ok(res.headers['role-tag'], 'resource role-tag header');
        t.equal(res.headers['role-tag'], A_ROLE_NAME, 'resource role-tag');
        t.end();
    });
});


test('sub-user signature auth (0.10)', function (t) {
    function subRequestSigner(req) {
        httpSignature.sign(req, {
            key: subPrivateKey,
            keyId: SUB_KEY_ID
        });
    }

    var mPath = util.format('/user/%s/%s', account, client.testSubUser);
    // We need to check that mahi-replicator has caught up with our latest
    // operation, which is adding the test-role to the test sub user:
    function waitMahiReplicator(cb) {
        waitForMahiCache(client.mahi, mPath, function (er, cache) {
            if (er) {
                client.log.error({err: er}, 'Error fetching mahi resource');
                t.fail('Error fetching mahi resource');
                t.end();
            } else {
                if (!cache.roles || Object.keys(cache.roles).length === 0 ||
                    Object.keys(cache.roles).indexOf(client.role.uuid) === -1) {
                    setTimeout(function () {
                        waitMahiReplicator(cb);
                    }, 1000);
                } else {
                    cb();
                }
            }
        });
    }


    waitMahiReplicator(function () {
        var cli = restify.createJsonClient({
            url: server ? server.url : 'https://127.0.0.1',
            retryOptions: {
                retry: 0
            },
            log: client.log,
            rejectUnauthorized: false,
            signRequest: subRequestSigner
        });

        t.test('sub-user get account', function (t2) {
            cli.get({
                path: '/' + account,
                headers: {
                    'accept-version': '~7.2'
                }
            }, function (err, req, res, obj) {
                t2.ok(err, 'sub-user get account error');
                t2.equal(res.statusCode, 403, 'sub-user auth statusCode');
                t2.end();
            });
        });

        t.test('sub-user get users', function (t1) {
            cli.get({
                path: '/' + account + '/users',
                headers: {
                    'accept-version': '~7.2'
                }
            }, function (err, req, res, obj) {
                t1.ifError(err, 'sub-user get users error');
                t1.equal(res.statusCode, 200, 'sub-user auth statusCode');
                t1.end();
            });
        });

        // Even when we've added the role-tag, the policies into the role don't
        // include a rule with route::string = 'getuser', therefore the 403:
        t.test('sub-user get thyself', function (t3) {
            cli.get({
                path: util.format('/%s/users/%s', account, client.testSubUser),
                headers: {
                    'accept-version': '~7.2'
                }
            }, function (err, req, res, obj) {
                t3.ok(err, 'sub-user get thyself error');
                t3.equal(res.statusCode, 403, 'sub-user auth statusCode');
                cli.close();
                t3.end();
            });
        });

        t.test('sub-user with as-role', function (t4) {
            var accountUuid = client.account.uuid;
            var roleUuid    = client.role.uuid;
            var ufds        = client.ufds;

            var oldDefaultMembers;
            function getRole(_, cb) {
                ufds.getRole(accountUuid, roleUuid, function (err, role) {
                    if (err) {
                        return cb(err);
                    }

                    oldDefaultMembers = role.uniquememberdefault;

                    return cb();
                });
            }

            function removeDefaultMembers(_, cb) {
                var changes = { uniquememberdefault: null };
                ufds.modifyRole(accountUuid, roleUuid, changes, cb);
            }

            function checkCannotGet(_, cb) {
                cli.get({
                    path: '/' + account + '/users',
                    headers: {
                        'accept-version': '~7.2'
                    }
                }, function (err, req, res, obj) {
                    cli.close();

                    if (err && err.statusCode !== 403) {
                        return cb(err);
                    }

                    return cb();
                });
            }

            function checkCanGetWithRole(_, cb) {
                cli.get({
                    path: '/' + account + '/users?as-role=' + client.role.name,
                    headers: {
                        'accept-version': '~7.2'
                    }
                }, function (err, req, res, obj) {
                    if (err) {
                        return cb(err);
                    }

                    cli.close();


                    if (res.statusCode !== 200) {
                        var msg = 'checkCanGetWithRole did not return 200';
                        return cb(new Error(msg));
                    }

                    return cb();
                });
            }

            function revertDefaultMembers(_, cb) {
                var changes = { uniquememberdefault: oldDefaultMembers };
                ufds.modifyRole(accountUuid, roleUuid, changes, cb);
            }

            vasync.pipeline({
                funcs: [
                    getRole, removeDefaultMembers, checkCannotGet,
                    checkCanGetWithRole, revertDefaultMembers
                ]
            }, function (err) {
                t4.ifError(err, 'sub-user with as-role error');
                t4.end();
            });
        });

        t.end();
    });
});


// Adding role-tag at creation time:
var B_ROLE_UUID, B_ROLE_DN, B_ROLE_NAME;

test('create role with role-tag', function (t) {
    var role_uuid = libuuid.create();
    var name = 'a' + role_uuid.substr(0, 7);

    var entry = {
        name: name,
        members: client.testSubUser,
        policies: [A_POLICY_NAME],
        default_members: client.testSubUser
    };

    client.post({
        path: '/my/roles',
        headers: {
            'role-tag': [A_ROLE_NAME]
        }
    }, entry, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        B_ROLE_UUID = body.id;
        B_ROLE_NAME = body.name;
        B_ROLE_DN = util.format(ROLE_FMT, B_ROLE_UUID, account.uuid);
        t.end();
    });
});


test('update role with role-tag', function (t) {
    var p = '/my/roles/' + B_ROLE_UUID;
    B_ROLE_NAME = 'Something-different';
    client.post({
        path: p,
        headers: {
            'role-tag': [A_ROLE_NAME]
        }
    }, {
        name: B_ROLE_NAME
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.end();
    });
});


test('delete role with role-tag', function (t) {
    var url = '/my/roles/' + B_ROLE_UUID;
    client.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('tag /:account with role', function (t) {
    client.put('/' + account, {
        'role-tag': [A_ROLE_NAME]
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body.name, 'resource role name');
        t.ok(body['role-tag'], 'resource role tag');
        t.ok(body['role-tag'].length, 'resource role tag ary');
        t.end();
    });
});


test('get /:account role-tag', function (t) {
    var p = '/' + account;
    client.get({
        path: p
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body.login, 'resource is a user');
        t.ok(res.headers['role-tag'], 'resource role-tag header');
        t.equal(res.headers['role-tag'], A_ROLE_NAME, 'resource role-tag');
        t.end();
    });
});


test('cleanup sdcAccountResources', function (t) {
    var id = client.account.uuid;
    client.ufds.listResources(id, function (err, resources) {
        t.ifError(err);
        vasync.forEachPipeline({
            inputs: resources,
            func: function (resource, _cb) {
                client.ufds.deleteResource(id, resource.uuid, function (er2) {
                    return _cb();
                });
            }
        }, function (er3, results) {
            t.ifError(er3);
            t.end();
        });
    });
});


test('teardown', function (t) {
    function nuke(callback) {
        client.teardown(function (err) {
            if (err) {
                return setTimeout(function () {
                    return nuke(callback);
                }, 500);
            }

            return callback(null);
        });
    }

    return nuke(function (er2) {
        t.ifError(er2, 'nuke tests error');

        if (server) {
            server._clients.ufds.client.removeAllListeners('close');
            server.close(function () {
                t.end();
            });
        } else {
            t.end();
        }
    });
});
