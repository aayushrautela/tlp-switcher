import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import * as ExtensionUtils from 'resource:///org/gnome/Shell/Extensions/js/misc/extensionUtils.js';

export default class TLPProfileSwitcherPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._window = window;
        const settings = this.getSettings();
        
        // Create main page
        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic'
        });
        
        // Appearance settings group
        const appearanceGroup = new Adw.PreferencesGroup({
            title: 'Appearance Settings',
            description: 'Configure how TLP Profile Switcher appears in Quick Settings'
        });
        
        // Widget width setting
        appearanceGroup.add(this._createWidthRow(settings));
        
        page.add(appearanceGroup);

        // One-time setup group
        page.add(this._createSetupGroup());
        window.add(page);
    }
    
    _createWidthRow(settings) {
        const widthRow = new Adw.ActionRow({
            title: 'Widget Width',
            subtitle: 'Choose how wide the widget should be in Quick Settings'
        });
        
        const widthDropdown = new Gtk.DropDown({
            model: Gtk.StringList.new(['1 column (standard)', '2 columns (wide)']),
            valign: Gtk.Align.CENTER
        });
        
        // Set current value (convert 1,2 to 0,1 for dropdown)
        const currentWidth = settings.get_int('widget-width');
        widthDropdown.selected = currentWidth - 1;
        
        // Connect to settings
        widthDropdown.connect('notify::selected', () => {
            const selectedWidth = widthDropdown.selected + 1; // Convert 0,1 to 1,2
            settings.set_int('widget-width', selectedWidth);
        });
        
        widthRow.add_suffix(widthDropdown);
        return widthRow;
    }

    _createSetupGroup() {
        const setupGroup = new Adw.PreferencesGroup({
            title: 'One-time Setup',
            description: 'Install the privileged helper and PolicyKit rule so switching works smoothly.'
        });

        const row = new Adw.ActionRow({
            title: 'Install system helper',
            subtitle: 'Copies helper to /usr/libexec and installs polkit policy'
        });

        const button = new Gtk.Button({ label: 'Run Setup', valign: Gtk.Align.CENTER });

        const updateUI = () => {
            const installed = this._isHelperInstalled();
            button.sensitive = !installed;
            row.subtitle = installed ? 'Helper and policy are installed' : 'Copies helper to /usr/libexec and installs polkit policy';
            // No need to store in GSettings - we check the actual files each time
        };

        button.connect('clicked', () => {
            button.sensitive = false;
            this._runSetup().then(() => {
                updateUI();
                this._showToast('Setup completed successfully', 'success');
            }).catch((e) => {
                updateUI();
                logError(e, 'Setup failed');
                this._showToast('Setup failed. Check logs for details.', 'error');
            });
        });

        row.add_suffix(button);
        setupGroup.add(row);
        updateUI();
        return setupGroup;
    }

    _isHelperInstalled() {
        try {
            const helper = Gio.File.new_for_path('/usr/libexec/tlp-switcher-helper');
            const policy = Gio.File.new_for_path('/usr/share/polkit-1/actions/org.mahaon.tlp-switcher.policy');
            return helper.query_exists(null) && policy.query_exists(null);
        } catch (_) {
            return false;
        }
    }

    async _runSetup() {
        const ext = ExtensionUtils.getCurrentExtension();
        const helperSrc = `${ext.path}/tool/tlp-switcher-helper`;
        const policySrc = `${ext.path}/polkit/org.mahaon.tlp-switcher.policy`;

        const cmd = [
            'pkexec',
            'sh', '-c',
            [
                `install -m 0755 "${helperSrc}" /usr/libexec/tlp-switcher-helper`,
                `install -m 0644 "${policySrc}" /usr/share/polkit-1/actions/org.mahaon.tlp-switcher.policy`,
                'systemctl restart polkit || true'
            ].join(' && '),
        ];

        return new Promise((resolve, reject) => {
            try {
                const flags = Gio.SubprocessFlags.STDOUT_PIPE | 
                              Gio.SubprocessFlags.STDERR_PIPE;
                const proc = Gio.Subprocess.new(cmd, flags);
                
                proc.communicate_utf8_async(null, null, (obj, res) => {
                    try {
                        const [, stdout, stderr] = obj.communicate_utf8_finish(res);
                        const exitStatus = obj.get_exit_status();
                        
                        if (stderr) {
                            log(`TLP Switcher setup stderr: ${stderr}`);
                        }
                        if (stdout) {
                            log(`TLP Switcher setup stdout: ${stdout}`);
                        }
                        
                        if (exitStatus === 0) {
                            resolve();
                        } else if (exitStatus === 126) {
                            // User cancelled or privilege denied
                            reject(new Error('Privilege required or user cancelled'));
                        } else {
                            reject(new Error(`Setup failed with exit code ${exitStatus}`));
                        }
                    } catch (e) {
                        logError(e, 'Error during setup communication');
                        reject(e);
                    }
                });
            } catch (e) {
                logError(e, 'Error creating subprocess');
                reject(e);
            }
        });
    }

    _showToast(message, type = 'info') {
        if (this._window) {
            const toast = new Adw.Toast({
                title: message,
                timeout: 3
            });
            this._window.add_toast(toast);
        }
        log(`TLP Switcher: ${message}`);
    }
}