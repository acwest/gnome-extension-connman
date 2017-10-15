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
const Mainloop = imports.mainloop;
const Signals = imports.signals;

const Clutter = imports.gi.Clutter;
const Gtk = imports.gi.Gtk;
const St = imports.gi.St;

const Util = imports.misc.util;

const PopupMenu = imports.ui.popupMenu;
const ModalDialog = imports.ui.modalDialog;

const Gettext = imports.gettext.domain('gnome-extension-connman');
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Ext = ExtensionUtils.getCurrentExtension();
const Version = Ext.imports.version;
const version = Version.version();

const DialogServiceItem = new Lang.Class({
    Name: 'DialogServiceItem',

    _init: function(service, callback) {
        let name = service.name || service.label.text;
        if(!name)
            return;
        let icon = service.getIcon();
        let securityIcon = service.securityIcon ? service.securityIcon() : '';
        this.service = service;
        this.actor = new St.BoxLayout({
            style_class: 'cm-dialog-item',
            can_focus: true,
            reactive: true
        });
        this.actor.connect('key-focus-in', function() {
            callback(this);
        }.bind(this));
        let action = new Clutter.ClickAction();
        action.connect('clicked', function() {
            this.actor.grab_key_focus();
        }.bind(this));
        this.actor.add_action(action);

        this._label = new St.Label({
            text: name
        });
        this.actor.label_actor = this._label;
        this._icons = new St.BoxLayout({
            style_class: 'cm-dialog-icons'
        });
        this._icon = new St.Icon({
            style_class: 'cm-dialog-icon'
        });
        this._securityIcon = new St.Icon({
            style_class: 'cm-dialog-icon'
        });
        this._icon.icon_name = icon;
        this._securityIcon.icon_name = securityIcon;
        if(service._properties['Favorite']) {
            let icon = new St.Icon({
                style_class: 'cm-dialog-icon',
                icon_name: 'object-select-symbolic'
            });
            icon.add_style_pseudo_class('favourite');
            this.actor.add_style_pseudo_class('favourite');
            this.actor.add(icon);
        }
        this._icons.add_actor(this._securityIcon);
        this._icons.add_actor(this._icon);
        this.actor.add(this._label, {
            x_align: St.Align.START
        });
        this.actor.add(this._icons, {
            expand: true,
            x_fill: false,
            x_align: St.Align.END
        });
    },

    enable: function() {
        this.actor.can_focus = true;
        this.actor.reactive = true;
        this.actor.remove_style_pseudo_class('passive');
    },

    disable: function() {
        this.actor.can_focus = false;
        this.actor.reactive = false;
        this.actor.add_style_pseudo_class('passive');
    }
});

const ServiceChooser = new Lang.Class({
    Name: 'ServiceChooser',
    Extends: ModalDialog.ModalDialog,

    _init: function(proxy, services, callback) {
        this.parent({
            styleClass: 'cm-dialog'
        });
        this._proxy = proxy;
        this._services = {};
        let headline = new St.BoxLayout({
            style_class: 'cm-dialog-header-hbox'
        });
        let icon = new St.Icon({
            style_class: 'cm-dialog-header-icon',
            icon_name: 'network-wireless-signal-excellent-symbolic'
        });
        let titleBox = new St.BoxLayout({
            vertical: true
        });
        let title = new St.Label({
            style_class: 'cm-dialog-header',
            text: _("Connect to...")
        });

        titleBox.add(title);

        headline.add(icon);
        headline.add(titleBox);

        this.contentLayout.style_class = 'cm-dialog-content';
        this.contentLayout.add(headline);

        this._stack = new St.Widget({
            layout_manager: new Clutter.BinLayout()
        });
        this._itemBox = new St.BoxLayout({
            vertical: true,
            style_class: 'cm-dialog-box'
        });
        this._boxes = {};
        this._scrollView = new St.ScrollView({
            style_class: 'cm-dialog-scroll-view'
        });
        this._scrollView.set_x_expand(true);
        this._scrollView.set_y_expand(true);
        this._scrollView.set_policy(Gtk.PolicyType.NEVER,
            Gtk.PolicyType.AUTOMATIC);
        this._scrollView.add_actor(this._itemBox);
        this._stack.add_child(this._scrollView);

        this.contentLayout.add(this._stack, {
            expand: true
        });

        for(let id in services)
            this.addService(services[id]);
        this.scanRemote();
        this._closed = false;
        this._timeout = Mainloop.timeout_add_seconds(15, function() {
            this.scanRemote();
            return !this._closed;
        }.bind(this));

        this._cancelButton = this.addButton({
            action: this.cancel.bind(this),
            label: _("Cancel"),
            key: Clutter.Escape
        });

        this._connectButton = this.addButton({
            action: this.buttonEvent.bind(this),
            label: _("Connect"),
            key: Clutter.Enter
        });
        this._connectButton.reactive = true;
        this._connectButton.can_focus = true;

        this._callback = callback;

        this.open();
    },

    scanRemote: function() {
        this._proxy.ScanRemote();
    },

    selectedEvent: function(service) {
        if(this._selected)
            this._selected.actor.remove_style_pseudo_class('selected');
        Util.ensureActorVisibleInScrollView(this._scrollView, service.actor);
        this._selected = service;
        this._selected.actor.add_style_pseudo_class('selected');
        this._connectButton.reactive = true;
        this._connectButton.can_focus = true;
    },

    close: function() {
        this.parent();
        this._closed = true;
        Mainloop.source_remove(this._timeout);
        this.destroy();
    },

    buttonEvent: function() {
        this.close();
        this._callback(this._selected && this._selected.service);
    },

    cancel: function() {
        this._callback();
        this.close();
    },

    addService: function(service) {
        if(this._services[service[0].id]) {
            this._services[service[0].id].enable();
            return;
        }
        let item = new DialogServiceItem(service[0], this.selectedEvent.bind(this));
        if(!item.actor)
            return;
        let intf = service[1];
        if(!this._boxes[intf]) {
            if(Object.keys(this._boxes).length === 1)
                this._boxes[Object.keys(this._boxes)[0]]['label'].show();
            let label = new St.Label({
                text: intf,
                style_class: 'cm-dialog-interface',
            });
            let box = new St.BoxLayout({
                vertical: true,
                style_class: 'cm-dialog-box'
            });
            this._boxes[intf] = {};
            this._boxes[intf]['label'] = label;
            this._boxes[intf]['box'] = box;
            label.hide();
            if(Object.keys(this._boxes).length > 1)
                label.show();
            this._itemBox.add_child(label);
            this._itemBox.add_child(box);
        }
        this._boxes[intf]['box'].add_child(item.actor);
        this._services[service[0].id] = item;
    },

    updateService: function(service) {
        if(this._closed)
            return;
        if(!this._services[service[0].id])
            this.addService(service);
        else
            this._services[service[0].id]._label.text = service[0].name || service[0].label.text;
    },

    removeService: function(id) {
        if(this._services[id])
            this._services[id].disable();
    }
});

const Service = new Lang.Class({
    Name: 'Service',
    Extends: PopupMenu.PopupSubMenuMenuItem,
    Abstract: true,

    _init: function(type, proxy, indicator) {
        this.parent('', true);

        this.type = type;

        this._properties = {};

        this._proxy = proxy;

        this._connected = true;
        this._connectionSwitch = new PopupMenu.PopupMenuItem(_("Connect"));
        this._connectionSwitch.connect('activate', this.buttonEvent.bind(this));

        this._sig = this._proxy.connectSignal('PropertyChanged',
            function(proxy, sender, [name, value]) {
                let obj = {};
                obj[name] = value;
                this.update(obj);
            }.bind(this));

        this.state = 'idle'
        this.hidden = true;

        this._icons = {
            'ok': 'network-transmit-receive-symbolic',
            'acquiring': 'network-no-route-symbolic',
            'offline': 'network-offline-symbolic',
            'error': 'network-error-symbolic'
        };

        this._indicator = indicator;
        this.label.text = '';

        this._settings = new PopupMenu.PopupMenuItem(_("Settings"));
        this._settings.connect('activate', this.openSettings.bind(this));

        if(version < 318)
            this.status.text = this.state;
        else
            this.label.text = this.state;

        this.menu.addMenuItem(this._connectionSwitch);
        this.menu.addMenuItem(this._settings);
        this.show();
    },

    openSettings: function() {
        Util.spawnApp(['connman-gtk', '--page', this.type]);
    },

    buttonEvent: function() {
        if(this.state === 'idle' || this.state === 'failure' || this.state === 'disconnect')
            this._proxy.ConnectRemote();
        else
            this._proxy.DisconnectRemote();
    },

    update: function(properties) {
        for(let key in properties) {
            let newProperty = properties[key].deep_unpack();
            if(newProperty instanceof Object && !(newProperty instanceof Array)) {
                if(!this._properties[key])
                    this._properties[key] = {};
                for(let innerKey in newProperty) {
                    this._properties[key][innerKey] =
                        newProperty[innerKey].deep_unpack();
                }
            } else {
                this._properties[key] = newProperty;
            }
        }
        if(properties.State)
            this.state = properties.State.deep_unpack();
        if(this.state === 'idle' || this.state === 'disconnect')
            this._connectionSwitch.label.text = _("Connect");
        else if(this.state === 'failure')
            this._connectionSwitch.label.text = _("Reconnect");
        else
            this._connectionSwitch.label.text = _("Disconnect");
        if(this._properties['Name']) {
            this.name = this._properties['Name'];
            this.hidden = false;
        }
        if(this.state === 'idle' || this.state === 'disconnect' ||
                this.state === 'failure')
            this._indicator.hide();
        else
            this._indicator.show();
        if(version < 318)
            this.status.text = this.getStateString();
        else
            this.label.text = this.name + " - " + this.getStateString();
        this.setIcon(this.getStatusIcon());
    },

    signalToIcon: function() {
        let value = this._properties['Strength'];
        if(value > 80)
            return 'excellent';
        if(value > 55)
            return 'good';
        if(value > 30)
            return 'ok';
        if(value > 5)
            return 'weak';
        return 'none';
    },

    getStateString: function() {
        let states = {
            idle: _("Idle"),
            failure: _("Failure"),
            association: _("Association"),
            configuration: _("Configuration"),
            ready: _("Ready"),
            disconnect: _("Disconnected"),
            online: _("Online") };
        return states[this.state] || this.state;
    },

    setIcon: function(iconName) {
        this._indicator.icon_name = iconName;
        this.icon.icon_name = iconName;
    },

    destroy: function() {
        this._indicator.destroy();
        try {
            this._proxy.disconnectSignal(this._sig);
        } catch(error) {
            Logger.logException(error, 'Failed to disconnect service proxy');
        }
        this.parent();
    },

    getIcon: function() {
        return this._icons['ok'];
    },

    getAcquiringIcon: function() {
        return this._icons['acquiring'];
    },

    getOfflineIcon: function() {
        return this._icons['offline'];
    },

    getErrorIcon: function() {
        return this._icons['error'];
    },

    getStatusIcon: function() {
        let iconGetters = {
            online: this.getIcon,
            ready: this.getIcon,
            configuration: this.getAcquiringIcon,
            association: this.getAcquiringIcon,
            disconnect: this.getOfflineIcon,
            idle: this.getOfflineIcon,
        };
        if(iconGetters[this.state])
            return iconGetters[this.state].bind(this)();
        return this.getErrorIcon();
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

const EthernetService = new Lang.Class({
    Name: 'EthernetService',
    Extends: Service,

    _init: function(proxy, indicator) {
        this.parent('ethernet', proxy, indicator);
        this.name = _("Wired");
        this.label.text = this.name;
        this._settings.label.text = _("Wired Settings");
        this._icons = {
            'ok': 'network-wired-symbolic',
            'acquiring': 'network-wired-acquiring-symbolic',
            'offline': 'network-wired-offline-symbolic',
            'error': 'network-error-symbolic'
        };

        this.show();
    },

    update: function(properties) {
        this.parent(properties);
        if(version < 318 && this._properties['Name'] === 'Wired') {
            /* ensure translated name */
            this._properties['Name'] = _("Wired");
            this.label.text = _("Wired");
        }
    }
});

const WirelessService = new Lang.Class({
    Name: 'WirelessService',
    Extends: Service,

    _init: function(proxy, indicator) {
        this.parent('wifi', proxy, indicator);
        this.name = _("Hidden");
        this._settings.label.text = _("Wireless Settings");
        this._icons = {
            'ok': 'network-wireless-connected-symbolic',
            'acquiring': 'network-wireless-acquiring-symbolic',
            'offline': 'network-wireless-offline-symbolic',
            'error': 'network-error-symbolic'
        };
    },

    securityIcon: function() {
        let security = this._properties['Security'][0];
        if(!security || security === 'none')
            return '';
        let icons = {
            ieee8021x: 'security-high-symbolic',
            wep: 'security-low-symbolic',
        };
        return icons[security] || 'security-medium-symbolic';
    },

    getIcon: function() {
        return 'network-wireless-signal-' + this.signalToIcon() + '-symbolic';
    },

    update: function(properties) {
        this.parent(properties);

        if(this.state === 'idle' || this.state === 'disconnect' ||
                this.state === 'failure')
            this.hide();
        else
            this.show();

        if(this.hidden) {
                let security = this._properties['Security'][0];
                if(!security)
                        security = 'none';
                let names = {
                        ieee8021x: _("Hidden ieee8021x secured network"),
                        psk: _("Hidden WPA secured network"),
                        wep: _("Hidden WEP secured network"),
                        wps: _("Hidden WPS secured network"),
                        none: _("Hidden unsecured network")
                };
                this.name = names[security] || _("Hidden network");
        }
    }
});

const BluetoothService = new Lang.Class({
    Name: 'BluetoothService',
    Extends: Service,

    _init: function(proxy, indicator) {
        this.parent('bluetooth', proxy, indicator);
        this._settings.label.text = _("Bluetooth Settings");
        this._icons = {
            'ok': 'bluetooth-active-symbolic',
            'acquiring': 'bluetooth-active-symbolic',
            'offline': 'bluetooth-disabled-symbolic',
            'error': 'network-error-symbolic'
        };

        this.show();
    },
});

const CellularService = new Lang.Class({
    Name: 'CellularService',
    Extends: Service,

    _init: function(proxy, indicator) {
        this.parent('cellular', proxy, indicator);
        this._settings.label.text = _("Cellular Settings");
        this._icons = {
            'ok': 'network-cellular-connected-symbolic',
            'acquiring': 'network-cellular-acquiring-symbolic',
            'offline': 'network-cellular-offline-symbolic',
            'error': 'network-error-symbolic'
        };

        this.show();
    },

    getIcon: function() {
        return 'network-cellular-signal-' + this.signalToIcon() + '-symbolic';
    }
});

const VPNService = new Lang.Class({
    Name: 'VPNService',
    Extends: Service,

    _init: function(proxy, indicator) {
        this.parent('vpn', proxy, indicator);
        this._settings.label.text = _("VPN Settings");
        this._icons = {
            'ok': 'network-vpn-symbolic',
            'acquiring': 'network-vpn-acquiring-symbolic',
            'offline': 'network-offline-symbolic',
            'error': 'network-error-symbolic',
        };

        this.show();
    },

    getAcquiringIcon: function() {
        return 'network-vpn-acquiring-symbolic';
    },

    getIcon: function() {
        return 'network-vpn-symbolic';
    }
});

function createService(type, proxy, indicator) {
    let services = {
        ethernet: EthernetService,
        wifi: WirelessService,
        bluetooth: BluetoothService,
        cellular: CellularService,
        vpn: VPNService
    };
    if(services[type])
        return new services[type](proxy, indicator);
    return new Service('other', proxy, indicator);
}
