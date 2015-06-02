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
const Signals = imports.signals;

const Clutter = imports.gi.Clutter;
const Gtk = imports.gi.Gtk;
const St = imports.gi.St;

const Util = imports.misc.util;

const PopupMenu = imports.ui.popupMenu;
const ModalDialog = imports.ui.modalDialog;

const DialogServiceItem = new Lang.Class({
    Name: 'DialogServiceItem',

    _init: function(service, callback) {
        let name = service.label.text;
        let icon = service.getIcon();
        this.service = service;
        this.actor = new St.BoxLayout({ style_class: 'nm-dialog-item',
            can_focus: true,
            reactive: true });
        this.actor.connect('key-focus-in', function() {
            callback(this);
        }.bind(this));
        let action = new Clutter.ClickAction();
        action.connect('clicked', function() {
            this.actor.grab_key_focus();
        }.bind(this));
        this.actor.add_action(action);

        this._label = new St.Label({ text: name });
        this.actor.label_actor = this._label;
        this._icon = new St.Icon({ style_class: 'nm-dialog-icon' });
        this._icon.icon_name = icon;
        this.actor.add(this._icon);
        this.actor.add(this._label);
    },
});

const ServiceChooser = new Lang.Class({
    Name: 'ServiceChooser',
    Extends: ModalDialog.ModalDialog,

    _init: function(services, callback) {
        this.parent({ styleClass: 'nm-dialog' });
        let headline = new St.BoxLayout({ style_class: 'nm-dialog-header-hbox' });
        let icon = new St.Icon({ style_class: 'nm-dialog-header-icon',
            icon_name: 'network-wireless-signal-excellent-symbolic' });
        let titleBox = new St.BoxLayout({ vertical: true });
        let title = new St.Label({ style_class: 'nm-dialog-header',
            text: "Connect to..." });

        titleBox.add(title);

        headline.add(icon);
        headline.add(titleBox);

        this.contentLayout.style_class = 'nm-dialog-content';
        this.contentLayout.add(headline);

        this._stack = new St.Widget({ layout_manager: new Clutter.BinLayout() });
        this._itemBox = new St.BoxLayout({ vertical: true,
            style_class: 'nm-dialog-box' });
        this._scrollView = new St.ScrollView({ style_class: 'nm-dialog-scroll-view'} );
        this._scrollView.set_x_expand(true);
        this._scrollView.set_y_expand(true);
        this._scrollView.set_policy(Gtk.PolicyType.NEVER,
                Gtk.PolicyType.AUTOMATIC);
        this._scrollView.add_actor(this._itemBox);
        this._stack.add_child(this._scrollView);

        this.contentLayout.add(this._stack, { expand: true });

        for(let id in services) {
            let service = services[id];
            let item = new DialogServiceItem(service, function(service) {
                if(this._selected)
                    this._selected.actor.remove_style_pseudo_class('selected');
                Util.ensureActorVisibleInScrollView(this._scrollView, service.actor);
                this._selected = service;
                this._selected.actor.add_style_pseudo_class('selected');
                this._connectButton.reactive = true;
                this._connectButton.can_focus = true;
            }.bind(this));
            this._itemBox.add_child(item.actor);
        }

        this._cancelButton = this.addButton({ action: this.close.bind(this),
            label: "Cancel",
            key: Clutter.Escape });

        this._connectButton = this.addButton({ action: this.buttonEvent.bind(this),
            label: "Connect",
            key: Clutter.Enter });
        this._connectButton.reactive = false;
        this._connectButton.can_focus = false;

        this._callback = callback;

        this.open();
    },

    buttonEvent: function() {
        if(!this._selected)
            return;
        this.close();
        this._callback(this._selected.service);
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
        this._connectionSwitch = new PopupMenu.PopupMenuItem("Connect");
        this._connectionSwitch.connect('activate', this.buttonEvent.bind(this));

        this._sig = this._proxy.connectSignal('PropertyChanged',
                function(proxy, sender, [name, value]) {
                    let obj = {};
                    obj[name] = value;
                    this.update(obj);
                }.bind(this));

        this.state = "";

        this._indicator = indicator;
        this._indicator.show();
        this.label.text = "Connection";
        this._settings = new PopupMenu.PopupMenuItem("Settings");

        this.status.text = this.state;

        this.menu.addMenuItem(this._connectionSwitch);
        this.menu.addMenuItem(this._settings);
        this.hide();
    },

    buttonEvent: function() {
        if(this.state == 'idle' || this.state == 'failure')
            this._proxy.ConnectRemote();
        else
            this._proxy.DisconnectRemote();
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
        if(this._properties['Name'])
            this.label.text = this._properties['Name'];
        this.status.text = this.state;
        this.setIcon(this.getStatusIcon());
    },

    setIcon: function(iconName) {
        this._indicator.icon_name = iconName;
        this.icon.icon_name = iconName;
    },

    destroy: function() {
        this._indicator.destroy();
        this._proxy.disconnectSignal(this._sig);
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

const EthernetService = new Lang.Class({
    Name: 'EthernetService',
    Extends: Service,

    _init: function(proxy, indicator) {
        this.parent('ethernet', proxy, indicator);
        this.label.text = "Wired Connection";
        this._settings.label.text = "Wired Settings";
        this.show();
    },
});

const WirelessService = new Lang.Class({
    Name: 'WirelessService',
    Extends: Service,

    _init: function(proxy, indicator) {
        this.parent('wifi', proxy, indicator);
        this.label.text = "Wireless Connection";
        this._settings.label.text = "Wireless Settings";
    },

    signalToIcon: function() {
        let value = this._properties['Strength'];
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

    getAcquiringIcon: function() {
        return 'network-wireless-acquiring-symbolic';
    },

    getIcon: function() {
        return 'network-wireless-signal-' + this.signalToIcon() + '-symbolic';
    },
});

const BluetoothService = new Lang.Class({
    Name: 'BluetoothService',
    Extends: Service,

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

function createService(type, proxy, indicator) {
    switch(type) {
    case 'ethernet':
        return new EthernetService(proxy, indicator);
    case 'wifi':
        return new WirelessService(proxy, indicator);
    case 'bluetooth':
        return new BluetoothService(proxy, indicator);
    default:
        throw 'tried to create unknown service type ' + type;
    }
}