/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

var fs = require('fs');
var util = require('util');
var test = require('tape').test;
var restify = require('restify');
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var sprintf = util.format;
var common = require('./common'),
    checkMahiCache = common.checkMahiCache,
    waitForMahiCache = common.waitForMahiCache;
var setup = require('./setup');
var machinesCommon = require('./machines/common');
var checkMachine = machinesCommon.checkMachine;
var checkJob = machinesCommon.checkJob;
var waitForJob = machinesCommon.waitForJob;
var checkWfJob = machinesCommon.checkWfJob;
var waitForWfJob = machinesCommon.waitForWfJob;
var saveKey = machinesCommon.saveKey;
var addPackage = machinesCommon.addPackage;
// --- Globals

var client, server, snapshot;
var keyName = uuid();
var machine;
var image_uuid;
var KEY = 'ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAIEAvad19ePSDckmgmo6Unqmd8' +
    'n2G7o1794VN3FazVhV09yooXIuUhA+7OmT7ChiHueayxSubgL2MrO/HvvF/GGVUs/t3e0u4' +
    '5YwRC51EVhyDuqthVJWjKrYxgDMbHru8fc1oV51l0bKdmvmJWbA/VyeJvstoX+eiSGT3Jge' +
    'egSMVtc= mark@foo.local';

var TAG_KEY = 'role';
var TAG_VAL = 'unitTest';

var META_KEY = 'foo';
var META_VAL = 'bar';

var META_64_KEY = 'sixtyfour';
var META_64_VAL = new Buffer('Hello World').toString('base64');

var META_CREDS = {
    'root': 'secret',
    'admin': 'secret'
};

var META_CREDS_TWO = {
    'root': 'secret',
    'admin': 'secret',
    'jill': 'secret'
};

var PROVISIONABLE_NET;

var sdc_256_entry, sdc_256_inactive_entry, sdc_128_ok_entry;

var HEADNODE = null;
var DATASET;

var account;

var A_POLICY_NAME;
var A_ROLE_NAME, A_ROLE_UUID;
var subPrivateKey;
var SUB_KEY_ID;
// This is the sub-user created machine:
var submachine;

var httpSignature = require('http-signature');

// --- Tests

test('setup', function (t) {
    common.setup('~7.2', function (err, _client, _server) {
        t.ifError(err, 'common setup error');
        t.ok(_client, 'common _client ok');

        client = _client;
        server = _server;

        account = client.account.login;
        A_ROLE_NAME = client.role.name;
        A_ROLE_UUID = client.role.id;
        A_POLICY_NAME = client.policy.name;
        subPrivateKey = client.subPrivateKey;
        SUB_KEY_ID = client.SUB_ID;

        saveKey(KEY, keyName, client, t, function () {
            // Add custom packages; "sdc_" ones will be owned by admin user:
            addPackage(client, setup.packages.sdc_128_ok,
                    function (err2, entry) {
                t.ifError(err2, 'Add package error');
                sdc_128_ok_entry = entry;

                addPackage(client, setup.packages.sdc_256_inactive,
                        function (err3, entry2) {
                    t.ifError(err3, 'Add package error');
                    sdc_256_inactive_entry = entry2;

                    t.end();
                });
            });
        });
    });
});


test('Get Headnode', function (t) {
    setup.getHeadnode(t, client, function (hn) {
        HEADNODE = hn;
        t.end();
    });
});


test('get base dataset', function (t) {
    setup.getBaseDataset(t, client, function (dataset) {
        DATASET = dataset;
        t.end();
    });
});


test('tag machines resource collection with role', function (t) {
    client.put('/my/machines', {
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


// Test using IMAGE.uuid instead of IMAGE.name due to PUBAPI-625:
test('CreateMachine', function (t) {
    var obj = {
        image: DATASET,
        'package': 'sdc_128_ok',
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE.uuid,
        firewall_enabled: true
    };
    obj['metadata.' + META_KEY] = META_VAL;
    obj['tag.' + TAG_KEY] = TAG_VAL;

    obj['metadata.credentials'] = META_CREDS;

    client.post({
        path: '/my/machines',
        headers: {
            'role-tag': [A_ROLE_NAME]
        }
    }, obj, function (err, req, res, body) {
        t.ifError(err, 'POST /my/machines error');
        t.equal(res.statusCode, 201, 'POST /my/machines status');
        common.checkHeaders(t, res.headers);
        t.equal(res.headers.location,
            util.format('/%s/machines/%s', client.testUser, body.id));
        t.ok(body, 'POST /my/machines body');
        checkMachine(t, body);
        machine = body.id;
        // Handy to output this to stdout in order to poke around COAL:
        console.log('Requested provision of machine: %s', machine);
        t.end();
    });
});


test('Wait For Running', function (t) {
    client.vmapi.listJobs({
        vm_uuid: machine,
        task: 'provision'
    }, function (err, jobs) {
        if (err) {
            // Skip machine tests when machine creation fails
            machine = null;
        }
        t.ifError(err, 'list jobs error');
        t.ok(jobs, 'list jobs ok');
        t.ok(jobs.length, 'list jobs is an array');
        waitForJob(client, jobs[0].uuid, function (err2) {
            if (err2) {
                // Skip machine tests when machine creation fails
                machine = null;
            }
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});


test('Get Machine', function (t) {
    if (machine) {
        client.get({
            path: '/my/machines/' + machine,
            headers: {
                'role-tag': true
            }
        }, function (err, req, res, body) {
            t.ifError(err, 'GET /my/machines/:id error');
            t.equal(res.statusCode, 200, 'GET /my/machines/:id status');
            common.checkHeaders(t, res.headers);
            t.ok(body, 'GET /my/machines/:id body');
            checkMachine(t, body);
            t.ok(body.compute_node, 'machine compute_node');
            t.ok(body.firewall_enabled, 'machine firewall enabled');
            t.ok(body.networks, 'machine networks');
            t.ok(Array.isArray(body.networks), 'machine networks array');
            // Double check tags are OK, due to different handling by VMAPI:
            var tags = {};
            tags[TAG_KEY] = TAG_VAL;
            t.deepEqual(body.tags, tags, 'Machine tags');
            t.ok(res.headers['role-tag'], 'resource role-tag header');
            t.equal(res.headers['role-tag'], A_ROLE_NAME, 'resource role-tag');
            t.end();
        });
    }
});


test('get provisionable network', function (t) {
    setup.getProvisionableNetwork(t, client, function (net) {
        PROVISIONABLE_NET = net;
        t.end();
    });
});


test('7.3 networks format should fail', function (t) {
    var obj = {
        image: DATASET,
        'package': 'sdc_128_ok',
        name: 'a' + uuid().substr(0, 7),
        networks: [ { ipv4_uuid: PROVISIONABLE_NET.id, ipv4_count: 1 } ],
        server_uuid: HEADNODE.uuid
    };

    client.post({
        path: '/my/machines'
    }, obj, function (err, req, res, body) {
        t.ok(err, 'error expected');
        if (err) {
            t.equal(err.message, 'Invalid Networks', 'error message');
        }

        t.end();
    });
});


test('sub-user tests', function (t) {
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
            url: server.url,
            retryOptions: {
                retry: 0
            },
            log: client.log,
            rejectUnauthorized: false,
            signRequest: subRequestSigner
        });

        // Need it to be able to poll jobs:
        cli.vmapi = client.vmapi;

        // Sub user tests go here, using a different client instance
        t.test('sub-user get machine', function (t1) {
            if (machine) {
                cli.get({
                    path: '/' + account + '/machines/' + machine,
                    headers: {
                        'accept-version': '~7.2',
                        'role-tag': true
                    }
                }, function (err, req, res, obj) {
                    t1.ifError(err, 'sub-user get machine error');
                    t1.equal(res.statusCode, 200, 'sub-user auth statusCode');
                    t1.ok(res.headers['role-tag'], 'resource role-tag header');
                    t1.equal(res.headers['role-tag'], A_ROLE_NAME,
                        'resource role-tag');
                    t1.equal(machine, obj.id, 'machine uuid');
                    cli.close();
                    t1.end();
                });
            } else {
                console.log('Eh no machine!: %j', machine);
                t1.end();
            }
        });

        t.test('Reboot test', function (t2) {
            var rebootTest = require('./machines/reboot');
            rebootTest(t2, cli, machine, function () {
                t2.end();
            });
        });

        // The sub-user role lacks of "POST" + 'stopmachine' route:
        t.test('Sub user cannot stop machine', function (t3) {
            cli.post({
                path: '/' + account + '/machines/' + machine,
                headers: {
                    'accept-version': '~7.2'
                }
            }, {
                action: 'stop'
            }, function (err, req, res, obj) {
                t3.ok(err, 'sub-user get account error');
                t3.equal(res.statusCode, 403, 'sub-user auth statusCode');
                t3.end();
            });
        });

        t.test('CreateMachine', function (t4) {
            var obj = {
                image: DATASET,
                'package': 'sdc_128_ok',
                name: 'a' + uuid().substr(0, 7),
                server_uuid: HEADNODE.uuid,
                firewall_enabled: true
            };
            obj['metadata.' + META_KEY] = META_VAL;
            obj['tag.' + TAG_KEY] = TAG_VAL;

            obj['metadata.credentials'] = META_CREDS;

            cli.post({
                path: '/' + account + '/machines',
                headers: {
                    'accept-version': '~7.2'
                }
            }, obj, function (err, req, res, body) {
                t4.ifError(err, 'POST /my/machines error');
                t4.equal(res.statusCode, 201, 'POST /my/machines status');
                common.checkHeaders(t, res.headers);
                t4.equal(res.headers.location,
                    util.format('/%s/machines/%s', client.testUser, body.id));
                t4.ok(body, 'POST /my/machines body');
                checkMachine(t4, body);
                submachine = body.id;
                // Handy to output this to stdout in order to poke around COAL:
                console.log('Requested provision of machine: %s', submachine);
                t4.end();
            });
        });

        t.test('Wait For Running', function (t5) {
            cli.vmapi.listJobs({
                vm_uuid: submachine,
                task: 'provision'
            }, function (err, jobs) {
                if (err) {
                    // Skip machine tests when machine creation fails
                    submachine = null;
                }
                t5.ifError(err, 'list jobs error');
                t5.ok(jobs, 'list jobs ok');
                t5.ok(jobs.length, 'list jobs is an array');
                waitForJob(cli, jobs[0].uuid, function (err2) {
                    if (err2) {
                        // Skip machine tests when machine creation fails
                        submachine = null;
                    }
                    t5.ifError(err2, 'Check state error');
                    t5.end();
                });
            });
        });

        t.test('Add machine role-tag', function (t6) {
            cli.put({
                path: '/' + account + '/machines/' + submachine,
                headers: {
                    'accept-version': '~7.2'
                }
            }, {
                'role-tag': [A_ROLE_NAME]
            }, function (err, req, res, body) {
                t6.ifError(err);
                t6.equal(res.statusCode, 200);
                t6.ok(body['role-tag']);
                t6.ok(Array.isArray(body['role-tag']));
                t6.equal(body['role-tag'][0], A_ROLE_NAME);
                t6.end();
            });
        });

        // Must be the last one or the sub-user will not be able to access
        // the machine:
        t.test('Remove machine role-tag', function (t7) {
            cli.put({
                path: '/' + account + '/machines/' + submachine,
                headers: {
                    'accept-version': '~7.2'
                }
            }, {
                'role-tag': []
            }, function (err, req, res, body) {
                t7.ifError(err);
                t7.equal(res.statusCode, 200);
                t7.ok(body['role-tag']);
                t7.ok(Array.isArray(body['role-tag']));
                t7.equal(0, body['role-tag'].length);
                cli.close();
                t7.end();
            });
        });

        t.end();
    });
});

test('Add submachine role-tag', function (t) {
    client.put({
        path: '/' + account + '/machines/' + submachine,
        headers: {
            'accept-version': '~7.2'
        }
    }, {
        'role-tag': [A_ROLE_NAME]
    }, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.ok(body['role-tag']);
        t.ok(Array.isArray(body['role-tag']));
        t.equal(body['role-tag'][0], A_ROLE_NAME);
        t.end();
    });
});


test('Delete tests', function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, client, machine, function () {
        t.end();
    });
});


test('Delete sub-user machine tests', function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, client, submachine, function () {
        t.end();
    });
});


test('teardown', function (t) {
    client.del('/my/keys/' + keyName, function (err, req, res) {
        t.ifError(err, 'delete key error');
        t.equal(res.statusCode, 204);

        common.teardown(client, server, function () {
            t.end();
        });
    });
});
