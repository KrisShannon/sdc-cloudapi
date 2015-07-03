/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var fs = require('fs');
var util = require('util');
var test = require('tape').test;
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var sprintf = util.format;
var setup = require('./setup');
var common = require('./common');
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


// May or not be created by previous test run or whatever else:
var sdc_256_inactive = {
    uuid: '4633473b-aae9-466b-8bde-3c410e5072cc',
    name: 'sdc_256_inactive',
    version: '1.0.0',
    max_physical_memory: 256,
    quota: 10240,
    max_swap: 512,
    cpu_cap: 150,
    max_lwps: 1000,
    zfs_io_priority: 10,
    'default': false,
    vcpus: 1,
    active: false
};

var sdc_128_ok = {
    uuid: '897779dc-9ce7-4042-8879-a4adccc94353',
    name: 'sdc_128_ok',
    version: '1.0.0',
    max_physical_memory: 128,
    quota: 10240,
    max_swap: 512,
    cpu_cap: 150,
    max_lwps: 1000,
    zfs_io_priority: 10,
    fss: 25,
    'default': false,
    vcpus: 1,
    active: true
};


var sdc_256_entry, sdc_256_inactive_entry, sdc_128_ok_entry;

var HEADNODE = null;
var DATASET;


// --- Tests

test('setup', function (t) {
    common.setup('~7.1', function (err, _client, _server) {
        t.ifError(err, 'common setup error');
        t.ok(_client, 'common _client ok');

        client = _client;
        server = _server;

        saveKey(KEY, keyName, client, t, function () {
            // Add custom packages; "sdc_" ones will be owned by admin user:
            addPackage(client, sdc_128_ok, function (err2, entry) {
                t.ifError(err2, 'Add package error');
                sdc_128_ok_entry = entry;

                addPackage(client, sdc_256_inactive, function (err3, entry2) {
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


// PUBAPI-567: Verify it has been fixed as side effect of PUBAPI-566
test('Create machine with invalid package', function (t) {
    var obj = {
        dataset: DATASET,
        'package': uuid().substr(0, 7),
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE.uuid
    };

    client.post('/my/machines', obj, function (err, req, res, body) {
        t.ok(err, 'POST /my/machines with invalid package error');
        console.log('Status Code: ' + res.statusCode);
        t.equal(res.statusCode, 409);
        t.end();
    });
});


test('CreateMachine w/o dataset fails', function (t) {
    var obj = {
        'package': 'sdc_128_ok',
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE.uuid
    };
    obj['metadata.' + META_KEY] = META_VAL;
    obj['tag.' + TAG_KEY] = TAG_VAL;

    obj['metadata.credentials'] = META_CREDS;

    client.post('/my/machines', obj, function (err, req, res, body) {
        t.ok(err, 'create machine w/o dataset error');
        t.equal(res.statusCode, 409, 'create machine w/o dataset status');
        t.ok(/image/.test(err.message));
        t.end();
    });
});


test('Create machine with invalid network', function (t) {
    var obj = {
        dataset: DATASET,
        'package': 'sdc_128_ok',
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE.uuid,
        networks: [uuid()]
    };

    client.post('/my/machines', obj, function (err, req, res, body) {
        t.ok(err, 'POST /my/machines with invalid network error');
        console.log('Status Code: ' + res.statusCode);
        t.equal(res.statusCode, 409);
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

    client.post('/my/machines', obj, function (err, req, res, body) {
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
        client.get('/my/machines/' + machine, function (err, req, res, body) {
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
            t.end();
        });
    }
});


test('Rename machine tests', function (t) {
    var renameTest = require('./machines/rename');
    renameTest(t, client, machine, function () {
        t.end();
    });
});


test('Firewall tests', function (t) {
    var firewallTest = require('./machines/firewall');
    firewallTest(t, client, machine, function () {
        t.end();
    });
});


test('Stop test', function (t) {
    var stopTest = require('./machines/stop');
    stopTest(t, client, machine, function () {
        t.end();
    });
});


test('Create image from machine (missing params)', function (t) {
    if (machine) {
        // Missing name attribute:
        var obj = {
            machine: machine,
            version: '1.0.0'
        };
        client.post({
            path: '/my/images',
            headers: {
                'accept-version': '~7.1'
            }
        }, obj, function (err, req, res, body) {
            t.ok(err, 'missing parameters error');
            t.equal(res.statusCode, 409);
            t.ok(err.message);
            t.end();
        });
    } else {
        t.end();
    }
});


var IMG_JOB_UUID;


test('Create image from machine OK', function (t) {
    if (machine) {
        var obj = {
            machine: machine,
            name: uuid(),
            version: '1.0.0'
        };
        client.post({
            path: '/my/images',
            headers: {
                'accept-version': '~7.1'
            }
        }, obj, function (err, req, res, body) {
            t.ifError(err);
            t.ok(body);
            image_uuid = body.id;
            t.ok(res.headers['x-joyent-jobid'], 'jobid header');
            IMG_JOB_UUID = res.headers['x-joyent-jobid'];
            t.end();
        });
    } else {
        t.end();
    }
});


test('Wait for img create job', function (t) {
    if (machine) {
        waitForWfJob(client, IMG_JOB_UUID, function (err) {
            if (err) {
                image_uuid = null;
            }
            t.ifError(err, 'create image job');
            t.end();
        });
    } else {
        t.end();
    }
});


test('Update image', function (t) {
    var obj = { name: uuid(), version: '1.1.0' };
    if (image_uuid) {
        var opts = {
            path: '/my/images/' + image_uuid,
            query: { action: 'update' }
        };
        client.post(opts, obj, function (err, req, res, body) {
            t.ifError(err, 'Update Image error');
            t.end();
        });
    } else {
        t.end();
    }
});


test('Delete image', function (t) {
    if (image_uuid) {
        client.imgapi.deleteImage(image_uuid, function (err, res) {
            t.ifError(err, 'Delete Image error');
            t.end();
        });
    } else {
        t.end();
    }
});



test('Delete tests', function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, client, machine, function () {
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
