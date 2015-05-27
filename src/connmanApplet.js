/*
 * Copyright (C) 2015 Intel Corporation. All rights reserved.
 * Author: Jaakko Hannikainen <jaakko.hannikainen@intel.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

const Lang = imports.lang;

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Ext = ExtensionUtils.getCurrentExtension();
const ConnmanAgent = Ext.imports.connmanAgent;
const ConnmanInterface = Ext.imports.connmanInterface;

const ConnectionItem = new Lang.Class({
    Name: 'ConnectionItem',
    Extends: PopupMenu.PopupSubMenuMenuItem,

    _init: function(type, proxy, indicator) {
        this.parent('', true);

        this._properties = {};

        this._proxy = proxy;

        this._connected = true;
        this._connectionSwitch = new PopupMenu.PopupMenuItem("Connect");
        this._connectionSwitch.connect('activate', function() {
            if(this.state == 'idle' || this.state == 'failure')
                this._proxy.ConnectRemote();
            else
                this._proxy.DisconnectRemote();
        }.bind(this));

        this._proxy.connectSignal('PropertyChanged',
                function(proxy, sender, [name, value]) {
                    let obj = {};
                    obj[name] = value;
                    this.update(obj);
                }.bind(this));

        this._indicator = indicator;
        this._indicator.show();
        this.label.text = "Connection";
        this._settings = new PopupMenu.PopupMenuItem("Settings");

        this.menu.addMenuItem(this._connectionSwitch);
        this.menu.addMenuItem(this._settings);
        this.hide();
    },

    update: function(properties) {
        for(let key in properties) {
            let newProperty = properties[key].deep_unpack();
            if(newProperty instanceof Object &&
                    !(newProperty instanceof Array)) {
                if(!this._properties[key])
                    this._properties[key] = {};
                for(let innerKey in newProperty) {
                    this._properties[key][innerKey] =
                        newProperty[innerKey].deep_unpack();
                }
            }
            else {
                this._properties[key] = newProperty;
            }
        }
        if(properties.State)
            this.state = properties.State.deep_unpack();
        if(this.state == 'idle')
            this._connectionSwitch.label.text = "Connect";
        else if(this.state == 'failure')
            this._connectionSwitch.label.text = "Reconnect";
        else
            this._connectionSwitch.label.text = "Disconnect";
        this.setIcon(this.getStatusIcon());
    },

    setIcon: function(iconName) {
        this._indicator.icon_name = iconName;
        this.icon.icon_name = iconName;
    },

    destroy: function() {
        this._indicator.destroy();
        this.parent();
    },

    getIcon: function() {
        return 'network-wired-symbolic';
    },

    getAcquiringIcon: function() {
        return 'network-wired-acquiring-symbolic';
    },

    getStatusIcon: function() {
        switch(this.state) {
        case 'online':
        case 'ready':
            return this.getIcon();
        case 'configuration':
        case 'association':
            return this.getAcquiringIcon();
        case 'disconnect':
        case 'idle':
            return 'network-offline-symbolic';
        case 'failure':
        default:
            return 'network-error-symbolic';
        }
    },

    show: function() {
        this.actor.show();
        this._indicator.show();
    },

    hide: function() {
        this.actor.hide();
        this._indicator.hide();
    }
});

const EthernetItem = new Lang.Class({
    Name: "EthernetItem",
    Extends: ConnectionItem,

    _init: function(proxy, indicator) {
        this.parent('ethernet', proxy, indicator);
        this.label.text = "Wired Connection";
        this._settings.label.text = "Wired Settings";
        this.show();
    },

    update: function(properties) {
        this.parent(properties);
        if(this._properties["Ethernet"]["Interface"])
            this.status.text = this._properties["Ethernet"]["Interface"];
    },
});

const WirelessItem = new Lang.Class({
    Name: "WirelessItem",
    Extends: ConnectionItem,

    _init: function(proxy, indicator) {
        this.parent('wireless', proxy, indicator);
    },

    signalToIcon: function() {
        let value = this._strength;
        if (value > 80)
            return 'excellent';
        if (value > 55)
            return 'good';
        if (value > 30)
            return 'ok';
        if (value > 5)
            return 'weak';
        return 'none';
    },

    update: function(properties) {
        this.parent(properties);
    },

    getAcquiringIcon: function() {
        return 'network-wireless-acquiring-symbolic';
    },

    getIcon: function() {
        return 'network-wireless-signal-' + this.signalToIcon() + '-symbolic';
    },
});

const BluetoothItem = new Lang.Class({
    Name: "BluetoothItem",
    Extends: ConnectionItem,

    _init: function(proxy, indicator) {
        this.parent('bluetooth', proxy, indicator);
    },

    getAcquiringIcon: function() {
        return 'bluetooth-active-symbolic';
    },

    getIcon: function() {
        return 'bluetooth-active-symbolic';
    }
});

/* menu with technologies and services */
const ConnmanMenu = new Lang.Class({
    Name: 'ConnmanMenu',
    Extends: PopupMenu.PopupMenuSection,

    _init: function(createIndicator) {
        this.parent();
        this._technologies = {};
        this._services = {};
        this._createIndicator = createIndicator;
    },

    hide: function() {
        this.actor.hide();
    },

    show: function() {
        this.actor.show();
    },

    addTechnology: function(type, properties) {
        log('adding technology ' + type);
        if(this._technologies[type])
            return;
        this._technologies[type] = {};
    },

    /* FIXME: for some reason destroying an item from the menu
     * leaves a hole, but for some reason this fixes it */
    fixMenu: function() {
        this.addMenuItem(new PopupMenu.PopupMenuItem('Connman'), 0);
        this.firstMenuItem.destroy();
    },

    removeTechnology: function(type) {
        log('removing technology ' + type);
        let technology = this._technologies[type];
        if(!technology) {
            log('tried to remove unknown technology ' + type);
            return;
        }
        technology.destroy();
        delete this._technologies[type];
        this.fixMenu();
    },

    updateService: function(path, properties) {
        log('updating service ' + path);
        let type = properties.Type.deep_unpack().split('/').pop();
        if(type != 'ethernet') {
            var technology = this._technologies[type];
            if(!technology)
                return;
        }

        if(!this._services[path]) {
            let proxy = new ConnmanInterface.ServiceProxy(path);
            let indicator = this._createIndicator();

            let service;
            if(type == "ethernet")
                service = new EthernetItem(proxy, indicator);
            else if(type == "wireless")
                service = new WirelessItem(proxy, indicator);
            else if(type == "bluetooth")
                service = new BluetoothItem(proxy, indicator);
            else
                service = new ConnectionItem(type, proxy, indicator);

            this.addMenuItem(service);
            this._services[path] = service;
            this._technologies[type][path] = service;
        }
        this._services[path].update(properties);
    },

    removeService: function(path) {
        log('removing service ' + path);
        if(!this._services[path]) {
            log('tried to remove unknown service ' + path);
            return;
        }
        this._services[path].destroy();
        delete this._services[path];
        this.fixMenu();
    },

    clear: function() {
        for(let path in this._services) {
            this._services[path].destroy();
            delete this._services[path];
        }
        for(let type in this._technologies) {
            this._technologies[type].destroy();
            delete this._technologies[type];
        }
        this._services = {};
        this._technologies = {};
    }
});

/* main applet class handling everything */
const ConnmanApplet = new Lang.Class({
    Name: 'ConnmanApplet',
    Extends: PanelMenu.SystemIndicator,

    _init: function() {
        this.parent();

        this._menu = new ConnmanMenu(this._addIndicator.bind(this));
        this.menu.addMenuItem(this._menu);
        this.menu.actor.show();
    },

    _updateAllServices: function() {
        this._manager.GetServicesRemote(function(result, exception) {
            if(!result || exception) {
                log('error fetching services: ' + exception);
                return;
            }
            let services = result[0];
            for each(let [path, properties] in services)
                this._menu.updateService(path, properties);
        }.bind(this));
    },

    _updateAllTechnologies: function() {
        this._menu.clear();
        this._manager.GetTechnologiesRemote(function(result, exception) {
            if(!result || exception) {
                log('error fetching technologies: ' + exception);
                return;
            }
            let technologies = result[0];
            for each(let [path, properties] in technologies)
                this._menu.addTechnology(path.split('/').pop(), properties);
            this._updateAllServices();
        }.bind(this));
    },

    _connectEvent: function() {
        this.menu.actor.show();

        this._manager = new ConnmanInterface.ManagerProxy();
        this._agent = new ConnmanAgent.Agent();

        this._manager.RegisterAgentRemote(ConnmanInterface.AGENT_PATH);
        this._asig = this._manager.connectSignal('TechnologyAdded',
                function(proxy, sender, [path, properties]) {
                    this._menu.addTechnology(path.split('/').pop(), properties);
                }.bind(this));
        this._rsig = this._manager.connectSignal('TechnologyRemoved',
                function(proxy, sender, [path, properties]) {
                    this._menu.removeTechnology(path.split('/').pop());
                }.bind(this));
        this._psig = this._manager.connectSignal('PropertyChanged',
                function(proxy, sender, [property, value]) {
                }.bind(this));
        this._ssig = this._manager.connectSignal('ServicesChanged',
                function(proxy, sender, [changed, removed]) {
                    log('Services Changed');
                    for each(let [path, properties] in changed) {
                        this._menu.updateService(path, properties);
                    }
                    for each(let path in removed) {
                        this._menu.removeService(path);
                    }
                }.bind(this));

        this._updateAllTechnologies();
        this.indicators.show();
    },

    _disconnectEvent: function() {
        this._menu.removeAll();
        this.menu.actor.hide();
        this.indicators.hide();
        if(this._manager) {
            this._manager.disconnectSignal(this._asig);
            this._manager.disconnectSignal(this._rsig);
            this._manager.disconnectSignal(this._ssig);
            this._manager.disconnectSignal(this._psig);
        }
        this._manager = null;
        if(this._agent)
            this._agent.destroy();
        this._agent = null;
    },

    enable: function() {
        if(!this._watch) {
            this._watch = Gio.DBus.system.watch_name(ConnmanInterface.BUS_NAME,
                    Gio.BusNameWatcherFlags.NONE,
                    function() { return this._connectEvent() }.bind(this),
                    function() { return this._disconnectEvent() }.bind(this));

        }
    },

    disable: function() {
        this.menu.actor.hide();
        this._indicator.hide();
        if(this._watch) {
            Gio.DBus.system.unwatch_name(this._watch);
            this._watch = null;
        }
        if(this._agent)
            this._agent.destroy();
        this._agent = null;
    },
});