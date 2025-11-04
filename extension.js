import St from 'gi://St';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Quick Settings Toggle with Menu
const TLPProfileToggle = GObject.registerClass(
    class TLPProfileToggle extends QuickSettings.QuickMenuToggle {
        _init(metadata) {
            super._init({
                title: 'TLP Profile',
                subtitle: 'Power Management',
                iconName: 'preferences-system-symbolic',
                toggleMode: false,
            });
            
            this.metadata = metadata;
            this.profilesPath = GLib.build_filenamev([GLib.get_home_dir(), '.tlp']);
            
            // Initialize components
            this._setupCustomIcon();
            this._ensureProfilesDirectory();
            this._setupMenuHeader();
            this._setupDirectoryMonitor();
            
            // Build initial menu
            this._buildMenu();
        }
        
        _setupCustomIcon() {
            try {
                const iconPath = GLib.build_filenamev([this.metadata.path, 'icons', 'speedometer5-symbolic.svg']);
                const iconFile = Gio.File.new_for_path(iconPath);
                
                if (iconFile.query_exists(null)) {
                    this.gicon = Gio.FileIcon.new(iconFile);
                    this.iconName = null; // Clear default icon
                }
            } catch (e) {
                logError(e, 'Failed to load custom icon, using fallback');
            }
        }
        
        _setupMenuHeader() {
            const headerIcon = this.gicon || 'preferences-system-symbolic';
            this.menu.setHeader(headerIcon, 'TLP Profile', 'Power Management');
        }
        
        _ensureProfilesDirectory() {
            const profilesDir = Gio.File.new_for_path(this.profilesPath);
            if (!profilesDir.query_exists(null)) {
                try {
                    profilesDir.make_directory_with_parents(null);
                } catch (e) {
                    logError(e, 'Failed to create profiles directory');
                }
            }
        }
        
        _setupDirectoryMonitor() {
            try {
                const profilesDir = Gio.File.new_for_path(this.profilesPath);
                if (!profilesDir.query_exists(null)) return;
                
                this.monitor = profilesDir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
                this.monitor.connect('changed', this._onDirectoryChanged.bind(this));
            } catch (e) {
                logError(e, 'Failed to setup directory monitor');
            }
        }
        
        _onDirectoryChanged() {
            // Debounce menu rebuilding
            if (this._rebuildTimeout) {
                GLib.source_remove(this._rebuildTimeout);
            }
            
            this._rebuildTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                this._buildMenu();
                this._rebuildTimeout = null;
                return GLib.SOURCE_REMOVE;
            });
        }
        
        async _buildMenu() {
            // Clear existing menu items
            this.menu.removeAll();
            
            // Get profiles and current active profile
            const profiles = this._getProfiles();
            let currentProfile = null;
            
            try {
                currentProfile = await this._getCurrentActiveProfile();
            } catch (e) {
                logError(e, 'Failed to get current active profile');
            }
            
            // Update subtitle
            this.subtitle = currentProfile ? `Active: ${currentProfile}` : 'Power Management';
            
            // Build menu content
            this._buildMenuContent(profiles, currentProfile);
        }
        
        _buildMenuContent(profiles, currentProfile) {
            if (profiles.length === 0) {
                this._addNoProfilesMessage();
                return;
            }
            
            // Add profiles section
            const profilesSection = new PopupMenu.PopupMenuSection();
            
            profiles.forEach(profile => {
                const item = new PopupMenu.PopupMenuItem(profile.name);
                
                // Add radio button icon
                const radioIcon = new St.Icon({
                    icon_name: currentProfile === profile.name ? 'radio-checked-symbolic' : 'radio-symbolic',
                    style_class: 'popup-menu-icon',
                    icon_size: 14
                });
                
                item.insert_child_at_index(radioIcon, 0);
                item.connect('activate', () => this._switchProfile(profile.path));
                
                profilesSection.addMenuItem(item);
            });
            
            this.menu.addMenuItem(profilesSection);
            
            // Add separator and actions
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addAction('Open Profiles Folder', () => this._openProfilesFolder());
        }
        
        _addNoProfilesMessage() {
            const noProfilesItem = new PopupMenu.PopupMenuItem('No profiles found', {
                reactive: false,
                can_focus: false
            });
            noProfilesItem.label.style_class = 'popup-inactive-text';
            this.menu.addMenuItem(noProfilesItem);
            
            const instructionItem = new PopupMenu.PopupMenuItem('Create .conf files in ~/.tlp/', {
                reactive: false,
                can_focus: false
            });
            instructionItem.label.style_class = 'popup-inactive-text';
            this.menu.addMenuItem(instructionItem);
            
            // Add separator and folder action
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addAction('Open Profiles Folder', () => this._openProfilesFolder());
        }
        
        async _getCurrentActiveProfile() {
            const tlpConfFile = Gio.File.new_for_path('/etc/tlp.conf');
            if (!tlpConfFile.query_exists(null)) {
                return null;
            }
            
            const tlpContent = await this._loadFileContentsAsync(tlpConfFile);
            if (!tlpContent) return null;
            
            const profiles = this._getProfiles();
            
            for (const profile of profiles) {
                try {
                    const profileFile = Gio.File.new_for_path(profile.path);
                    const profileContent = await this._loadFileContentsAsync(profileFile);
                    
                    if (profileContent && this._compareProfiles(tlpContent, profileContent)) {
                        return profile.name;
                    }
                } catch (e) {
                    // Continue checking other profiles
                    continue;
                }
            }
            
            return null;
        }
        
        _loadFileContentsAsync(file) {
            return new Promise((resolve, reject) => {
                file.load_contents_async(null, (source, result) => {
                    try {
                        const [success, contents] = source.load_contents_finish(result);
                        if (success) {
                            resolve(new TextDecoder().decode(contents));
                        } else {
                            resolve(null);
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            });
        }
        
        _getProfiles() {
            const profiles = [];
            
            try {
                const profilesDir = Gio.File.new_for_path(this.profilesPath);
                if (!profilesDir.query_exists(null)) {
                    return profiles;
                }
                
                const enumerator = profilesDir.enumerate_children(
                    'standard::name,standard::type',
                    Gio.FileQueryInfoFlags.NONE,
                    null
                );
                
                let fileInfo;
                while ((fileInfo = enumerator.next_file(null)) !== null) {
                    const name = fileInfo.get_name();
                    const type = fileInfo.get_file_type();
                    
                    if (type === Gio.FileType.REGULAR && name.endsWith('.conf')) {
                        profiles.push({
                            name: name.replace('.conf', ''),
                            path: GLib.build_filenamev([this.profilesPath, name])
                        });
                    }
                }
                
                enumerator.close(null);
                
				// Sort profiles with custom priority: Performance, Balanced, Power Saver, then others alphabetically
				const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
				const aliasToKey = (s) => {
					const n = normalize(s);
					if (n === 'performance') return 'performance';
					if (n === 'balanced') return 'balanced';
					// Common aliases for power saver
					if (n === 'power saver' || n === 'powersaver' || n === 'power save' || n === 'battery' || n === 'battery saver' || n === 'battery saving') return 'power saver';
					return n;
				};
				const priority = new Map([
					['performance', 0],
					['balanced', 1],
					['power saver', 2],
				]);
				profiles.sort((a, b) => {
					const ak = aliasToKey(a.name);
					const bk = aliasToKey(b.name);
					const ar = priority.has(ak) ? priority.get(ak) : Number.POSITIVE_INFINITY;
					const br = priority.has(bk) ? priority.get(bk) : Number.POSITIVE_INFINITY;
					if (ar !== br) return ar - br;
					// Same priority (both non-priority or same bucket): sort alphabetically by original name
					return a.name.localeCompare(b.name);
				});
            } catch (e) {
                logError(e, 'Failed to get profiles list');
            }
            
            return profiles;
        }
        
        _switchProfile(profilePath) {
            const command = [
                'pkexec',
                'sh', '-c',
                `cp "${profilePath}" /etc/tlp.conf && tlp start`
            ];
            
            try {
                const proc = Gio.Subprocess.new(
                    command,
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                );
                
                proc.wait_async(null, (source, result) => {
                    try {
                        const success = source.wait_finish(result);
                        if (success && source.get_successful()) {
                            this._scheduleMenuUpdate();
                        } else {
                            logError(new Error('Profile switch failed'), `Failed to switch to profile: ${profilePath}`);
                        }
                    } catch (e) {
                        logError(e, 'Failed to switch profile');
                    }
                });
            } catch (e) {
                logError(e, 'Failed to execute profile switch command');
            }
        }
        
        _scheduleMenuUpdate() {
            if (this._updateMenuTimeout) {
                GLib.source_remove(this._updateMenuTimeout);
            }
            
            this._updateMenuTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._buildMenu();
                this._updateMenuTimeout = null;
                return GLib.SOURCE_REMOVE;
            });
        }
        
        _openProfilesFolder() {
            try {
                Gio.Subprocess.new(
                    ['xdg-open', this.profilesPath],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                );
            } catch (e) {
                logError(e, 'Failed to open profiles folder');
            }
        }
        
        _compareProfiles(content1, content2) {
            const normalize = (content) => {
                return content
                    .split('\n')
                    .filter(line => {
                        const trimmed = line.trim();
                        return trimmed && !trimmed.startsWith('#') && trimmed.includes('=');
                    })
                    .map(line => line.trim())
                    .sort()
                    .join('\n');
            };
            
            return normalize(content1) === normalize(content2);
        }
        
        destroy() {
            // Clean up monitor
            if (this.monitor) {
                this.monitor.cancel();
                this.monitor = null;
            }
            
            // Clean up timeouts
            [this._rebuildTimeout, this._updateMenuTimeout].forEach(timeout => {
                if (timeout) {
                    GLib.source_remove(timeout);
                }
            });
            
            this._rebuildTimeout = null;
            this._updateMenuTimeout = null;
            
            super.destroy();
        }
    }
);

// System Indicator for Quick Settings
const TLPSystemIndicator = GObject.registerClass(
    class TLPSystemIndicator extends QuickSettings.SystemIndicator {
        _init(metadata) {
            super._init();
            
            this._toggle = new TLPProfileToggle(metadata);
            this.quickSettingsItems.push(this._toggle);
        }
        
        destroy() {
            this._toggle?.destroy();
            super.destroy();
        }
    }
);

// Main extension class
export default class TLPProfileSwitcherExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._indicator = null;
        this._settings = null;
        this._widthChangedId = null;
    }
    
    enable() {
        this._settings = this.getSettings();
        this._indicator = new TLPSystemIndicator(this.metadata);
        
        // Get width from settings and add to Quick Settings
        const widgetWidth = this._settings.get_int('widget-width');
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator, widgetWidth);
        
        // Listen for width changes
        this._widthChangedId = this._settings.connect('changed::widget-width', () => {
            this._recreateIndicator();
        });
    }
    
    _recreateIndicator() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = new TLPSystemIndicator(this.metadata);
            const newWidth = this._settings.get_int('widget-width');
            Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator, newWidth);
        }
    }
    
    disable() {
        if (this._widthChangedId) {
            this._settings.disconnect(this._widthChangedId);
            this._widthChangedId = null;
        }
        
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        
        this._settings = null;
    }
}