#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2015, Joyent, Inc.
#

#
# Makefile: basic Makefile for template API service
#
# This Makefile is a template for new repos. It contains only repo-specific
# logic and uses included makefiles to supply common targets (javascriptlint,
# jsstyle, restdown, etc.), which are used by other repos as well. You may well
# need to rewrite most of this file, but you shouldn't need to touch the
# included makefiles.
#
# If you find yourself adding support for new targets that could be useful for
# other projects too, you should add these to the original versions of the
# included Makefiles (in eng.git) so that other teams can use them too.
#
NAME		:= cloudapi
#
# Tools
#
TAP		:= ./node_modules/.bin/tape

#
# Files
#
DOC_FILES	 = index.md admin.md dev.md
RESTDOWN_FLAGS   = --brand-dir=deps/restdown-brand-remora
EXTRA_DOC_DEPS += deps/restdown-brand-remora/.git
JS_FILES	:= $(shell ls *.js) $(shell find lib -maxdepth 1 -name '*.js') \
	$(shell find test -name '*.js') $(shell find bench -name '*.js') \
	$(shell find plugins -name '*.js') \
	$(shell find test -name '*.javascript')
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = $(JS_FILES)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -f tools/jsstyle.conf
SMF_MANIFESTS_IN    = smf/manifests/cloudapi.xml.in smf/manifests/haproxy.xml.in smf/manifests/stud.xml.in

CLEAN_FILES	+= node_modules cscope.files

# The prebuilt sdcnode version we want. See
# "tools/mk/Makefile.node_prebuilt.targ" for details.
NODE_PREBUILT_VERSION=v0.10.42
ifeq ($(shell uname -s),SunOS)
	NODE_PREBUILT_IMAGE=de411e86-548d-11e4-a4b7-3bb60478632a
	NODE_PREBUILT_TAG=zone
endif


include ./tools/mk/Makefile.defs
ifeq ($(shell uname -s),SunOS)
	include ./tools/mk/Makefile.node_prebuilt.defs
else
	include ./tools/mk/Makefile.node.defs
endif
include ./tools/mk/Makefile.smf.defs


#
# Variables
#

# Mountain Gorilla-spec'd versioning.


ROOT                    := $(shell pwd)
RELEASE_TARBALL         := $(NAME)-pkg-$(STAMP).tar.bz2
RELSTAGEDIR                  := /tmp/$(STAMP)

#
# Env vars
#
PATH	:= $(NODE_INSTALL)/bin:/opt/local/bin:${PATH}


#
# Repo-specific targets
#
.PHONY: all
all: build sdc-scripts

.PHONY: build
build: haproxy $(SMF_MANIFESTS) | $(TAP) $(REPO_DEPS)
	$(NPM) install

$(TAP): | $(NPM_EXEC)
	$(NPM) install

DOC_CLEAN_FILES = docs/{index,admin,dev}.{html,json} build/docs
.PHONY: clean-docs
clean-docs:
	-$(RMTREE) $(DOC_CLEAN_FILES)
clean:: clean-docs


# Build HAProxy when in SunOS
.PHONY: haproxy
ifeq ($(shell uname -s),SunOS)
haproxy:
	@echo "Building HAproxy"
	cd deps/haproxy-1.4.21 && /opt/local/bin/gmake TARGET=solaris
else
haproxy:
	@echo "HAproxy building only in SunOS"
endif


CLEAN_FILES += deps/haproxy-1.4.21/haproxy


.PHONY: release
release: check build docs
	@echo "Building $(RELEASE_TARBALL)"
	@mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/cloudapi
	@mkdir -p $(RELSTAGEDIR)/site
	@touch $(RELSTAGEDIR)/site/.do-not-delete-me
	@mkdir -p $(RELSTAGEDIR)/root
	@mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/cloudapi/ssl
	cp -r	$(ROOT)/bin \
		$(ROOT)/deps/haproxy-1.4.21 \
		$(ROOT)/etc \
		$(ROOT)/lib \
		$(ROOT)/plugins \
		$(ROOT)/main.js \
		$(ROOT)/node_modules \
		$(ROOT)/package.json \
		$(ROOT)/sapi_manifests \
		$(ROOT)/smf \
		$(ROOT)/test \
		$(ROOT)/tools \
		$(RELSTAGEDIR)/root/opt/smartdc/cloudapi/
	mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/boot
	cp -R $(ROOT)/deps/sdc-scripts/* $(RELSTAGEDIR)/root/opt/smartdc/boot/
	cp -R $(ROOT)/boot/* $(RELSTAGEDIR)/root/opt/smartdc/boot/
	mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/$(NAME)/build
	cp -r \
		$(TOP)/build/node \
		$(TOP)/build/docs \
		$(RELSTAGEDIR)/root/opt/smartdc/$(NAME)/build
	(cd $(RELSTAGEDIR) && $(TAR) -jcf $(ROOT)/$(RELEASE_TARBALL) root site)
	@rm -rf $(RELSTAGEDIR)


.PHONY: publish
publish: release
	@if [[ -z "$(BITS_DIR)" ]]; then \
	  echo "error: 'BITS_DIR' must be set for 'publish' target"; \
	  exit 1; \
	fi
	mkdir -p $(BITS_DIR)/$(NAME)
	cp $(ROOT)/$(RELEASE_TARBALL) $(BITS_DIR)/$(NAME)/$(RELEASE_TARBALL)

.PHONY: test no_machines_test auth_test account_test analytics_test datacenters_test datasets_test fabrics_test images_test keys_test networks_test nics_test machines_all_test machines_70_test machines_71_test machines_72_test machines_73_test machines_80_test machines_test packages_test populate_networks_test services_test users_test provision_limits_plugin_test plugins_test

auth_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/auth.test.js

account_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/account.test.js

analytics_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/analytics.test.js

datacenters_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/datacenters.test.js

datasets_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/datasets.test.js

fabrics_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/fabrics.test.js

images_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/images.70.test.js
	$(NODE_EXEC) $(TAP) test/images.80.test.js
	$(NODE_EXEC) $(TAP) test/images.test.js

keys_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/keys.test.js

networks_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/networks.test.js

nics_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/nics.test.js

machines_all_test:
	$(NODE_EXEC) $(TAP) test/machines.test.js

machines_70_test:
	$(NODE_EXEC) $(TAP) test/machines.70.test.js

machines_71_test:
	$(NODE_EXEC) $(TAP) test/machines.71.test.js

machines_72_test:
	$(NODE_EXEC) $(TAP) test/machines.72.test.js

machines_73_test:
	$(NODE_EXEC) $(TAP) test/machines.73.test.js

machines_80_test:
	$(NODE_EXEC) $(TAP) test/machines.80.test.js

machines_test: machines_all_test machines_70_test machines_71_test machines_72_test machines_73_test machines_80_test

packages_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/packages.test.js

populate_network_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/populate_network.test.js

services_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/services.test.js

users_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/users.test.js

test: auth_test account_test analytics_test datacenters_test datasets_test fabrics_test images_test keys_test networks_test packages_test populate_network_test services_test users_test nics_test machines_test

no_machines_test: auth_test account_test analytics_test datacenters_test datasets_test fabrics_test images_test keys_test networks_test packages_test populate_network_test services_test users_test

provision_limits_plugin_test:
	$(NODE_EXEC) $(TAP) test/provision_limits.test.javascript

plugins_test: provision_limits_plugin_test

include ./tools/mk/Makefile.deps
ifeq ($(shell uname -s),SunOS)
	include ./tools/mk/Makefile.node_prebuilt.targ
else
	include ./tools/mk/Makefile.node.targ
endif
include ./tools/mk/Makefile.smf.targ
include ./tools/mk/Makefile.targ

sdc-scripts: deps/sdc-scripts/.git
