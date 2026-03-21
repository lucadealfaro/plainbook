import { ref, reactive, onMounted, computed, watch } from './vue.esm-browser.js';

export default {
    props: ['authToken'],
    emits: ['file-counts'],
    setup(props, { emit }) {
        const currentPath = ref('/'); // Root path
        const fileList = ref([]);     // Files in the current directory
        const selectedFiles = reactive(new Map()); // Path -> File object mapping
        const missingFiles = reactive(new Map()); // Path -> File object mapping for missing files
        const isLoading = ref(false);
        const filterQuery = ref(''); // Search state
        
        const filteredFiles = computed(() => {
            const query = filterQuery.value.toLowerCase();
            return fileList.value.filter(f => f.name.toLowerCase().includes(query));
        });

        const fetchFiles = async (path) => {
            isLoading.value = true;
            filterQuery.value = ''; // Reset search when changing folders
            try {
                const response = await fetch(`/file_list?token=${props.authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: path })
                });
                const data = await response.json();
                fileList.value = data.files || []; 
                currentPath.value = path;
            } catch (err) {
                throw new Error("Failed to fetch files", { cause: err });
            } finally {
                isLoading.value = false;
            }
        };

        // Navigation actions
        const openFolder = (folder) => {
            fetchFiles(folder.path);
        };

        const goUp = () => {
            const parts = currentPath.value.split('/').filter(Boolean);
            parts.pop();
            const parentPath = '/' + parts.join('/');
            fetchFiles(parentPath);
        };

        const goHome = async () => {
            try {
                const res = await fetch(`/home_dir?token=${props.authToken}`);
                const data = await res.json();
                await fetchFiles(data.path);
            } catch (err) {
                console.warn('Failed to navigate to home directory:', err);
            }
        };

        const goCurrent = async () => {
            try {
                const res = await fetch(`/current_dir?token=${props.authToken}`);
                const data = await res.json();
                await fetchFiles(data.path);
            } catch (err) {
                console.warn('Failed to navigate to current directory:', err);
            }
        };

        // Selection actions
        const toggleSelection = (file) => {
            if (selectedFiles.has(file.path)) {
                selectedFiles.delete(file.path);
            } else {
                selectedFiles.set(file.path, file);
            }
        };

        const removeSelected = (path) => {
            selectedFiles.delete(path);
        };

        const removeMissing = (path) => {
            missingFiles.delete(path);
        }

        const syncSelectedFiles = async () => {
            // Convert Map values to a plain array of file objects
            try {
                await fetch(`/set_files?token=${props.authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        files: Array.from(selectedFiles.values()),
                        missing_files: Array.from(missingFiles.values())
                    })
                });
            } catch (err) {
                throw new Error("Failed to sync files with notebook", { cause: err });
            }
        };

        const emitCounts = () => {
            emit('file-counts', { selected: selectedFiles.size, missing: missingFiles.size });
        };

        watch(selectedFiles, () => { syncSelectedFiles(); emitCounts(); }, { deep: true });
        watch(missingFiles,  () => { syncSelectedFiles(); emitCounts(); }, { deep: true });

        // Load selected files mapping from server and populate `selectedFiles`
        const loadSelectedFiles = async () => {
            try {
                const res = await fetch(`/get_files?token=${props.authToken}`);
                if (!res.ok) return;
                const data = await res.json();
                // Clear existing selection and repopulate
                selectedFiles.clear();
                data.files.forEach(f => {
                    selectedFiles.set(f.path, f);
                });
                missingFiles.clear();
                data.missing_files.forEach(f => {
                    missingFiles.set(f.path, f);
                });
                emitCounts();
            } catch (err) {
                console.warn('Failed to load selected input files:', err);
            }
        };

        // Get home dir on load
        const initialize = async () => {
            try {
                const res = await fetch(`/current_dir?token=${props.authToken}`);
                const data = await res.json();
                await fetchFiles(data.path);
                await loadSelectedFiles();
            } catch (err) {
                await fetchFiles('/');
                await loadSelectedFiles();
            }
        };

        // Initial load
        onMounted(initialize);

        return {
            currentPath, fileList, isLoading,
            selectedFiles, missingFiles, filterQuery, filteredFiles,
            openFolder, goUp, goHome, goCurrent, toggleSelection, removeSelected, removeMissing
        };
    },
    template: /* html */ `
            <div style="display: flex; height: 400px;" class="file-browser">
                <div style="flex: 1; border-right: 1px solid var(--bulma-border); display: flex; flex-direction: column;">
                    <div class="file-browser-header">Select files for notebook access, so AI knows where to find them.</div>
                    <div class="file-browser-filter">
                        <input type="text" v-model="filterQuery" placeholder="Filter files..."
                            style="flex: 1; padding: 4px;">
                    </div>
                    <div class="file-browser-nav">
                        <button @click="goUp" :disabled="currentPath === '/'" class="button is-small is-light">
                            <span class="icon is-small"><i class="bx bx-arrow-big-up"></i></span>
                            <span>Up</span>
                        </button>
                        <button @click="goHome" class="button is-small is-light">
                            <span class="icon is-small"><i class="bx bx-home"></i></span>
                            <span>Home</span>
                        </button>
                        <button @click="goCurrent" class="button is-small is-light">
                            <span class="icon is-small"><i class="bx bx-target"></i></span>
                            <span>Current</span>
                        </button>
                        <code style="font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ currentPath }}</code>
                    </div>
                    <div style="overflow-y: auto; flex: 1;">
                        <div v-if="isLoading" class="text-muted" style="padding: 1rem;">Loading...</div>
                        <ul v-else style="list-style: none; margin: 0; padding: 0;">
                            <li v-for="item in filteredFiles" :key="item.path" class="file-item">

                                <span style="width: 1rem; min-width: 1rem; display: flex; justify-content: center; align-items: center; flex-shrink: 0;">
                                    <input type="checkbox" v-if="item.type === 'file'"
                                           :checked="selectedFiles.has(item.path)"
                                           @change="toggleSelection(item)"
                                           style="width: 0.8rem; height: 0.8rem; margin: 0; cursor: pointer;">
                                </span>

                                <span class="icon is-small" :class="item.type === 'directory' ? 'dir-icon' : ''">
                                    <i :class="item.type === 'directory' ? 'bx bx-folder' : 'bx bx-file'"></i>
                                </span>

                                <span v-if="item.type === 'directory'"
                                      @click="openFolder(item)"
                                      class="file-name-link is-size-7">
                                    {{ item.name }}/
                                </span>
                                <span v-else class="is-size-7">{{ item.name }}</span>
                            </li>
                        </ul>
                    </div>
                </div>

                <div class="selected-files-panel">
                    <div class="selected-files-header">Selected Files ({{ selectedFiles.size }})</div>
                    <div style="overflow-y: auto; flex: 1; padding: 0.5rem;">
                        <div v-if="selectedFiles.size === 0" class="text-subtle" style="font-style: italic;">No files selected</div>
                        <ul style="list-style: none; margin: 0; padding: 0;">
                            <li v-for="[path, file] in selectedFiles" :key="path" class="selected-file-card">
                                <button @click="removeSelected(path)" class="delete has-background-danger is-small" style="margin-top: 4px;">
                                </button>
                                <div style="display: flex; flex-direction: column; min-width: 0;">
                                    <div class="selected-file-name" :title="path">
                                        {{ file.name }}
                                    </div>
                                    <div class="selected-file-path">
                                        {{ path }}
                                    </div>
                                </div>
                            </li>
                        </ul>
                    </div>
                    <div v-if="missingFiles.size > 0" class="selected-files-header has-text-danger">Missing Files ({{ missingFiles.size }})</div>
                    <div v-if="missingFiles.size > 0" style="overflow-y: auto; flex: 1; padding: 0.5rem;">
                        <ul style="list-style: none; margin: 0; padding: 0;">
                            <li v-for="[path, file] in missingFiles" :key="path" class="selected-file-card" style="padding: 4px; border-radius: 3px; margin-bottom: 4px; font-size: 0.85rem;">
                                <button @click="removeMissing(path)" class="delete has-background-danger is-small mr-2">
                                </button>
                                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" :title="path">
                                    {{ file.name }}
                                </span>
                            </li>
                        </ul>
                    </div>

                </div>

            </div>
    `
};
