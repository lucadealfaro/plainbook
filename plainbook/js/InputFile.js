import { ref, reactive, onMounted, computed, watch } from './vue.esm-browser.js';

export default {
    props: ['authToken'],
    setup(props) {
        const isCollapsed = ref(true);
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
                const response = await fetch(`/file-list?token=${props.authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: path })
                });
                const data = await response.json();
                fileList.value = data.files || []; 
                currentPath.value = path;
            } catch (err) {
                throw new Error("Failed to fetch files:", err);
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
                await fetch(`/set-files?token=${props.authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        files: Array.from(selectedFiles.values()),
                        missing_files: Array.from(missingFiles.values())
                    })
                });
            } catch (err) {
                throw new Error("Failed to sync files with notebook:", err);
            }
        };

        watch(selectedFiles, syncSelectedFiles, { deep: true });
        watch(missingFiles,  syncSelectedFiles, { deep: true });

        const toggleCollapse = () => isCollapsed.value = !isCollapsed.value;

        // Load selected files mapping from server and populate `selectedFiles`
        const loadSelectedFiles = async () => {
            try {
                const res = await fetch(`/get-files?token=${props.authToken}`);
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
            } catch (err) {
                console.warn('Failed to load selected input files:', err);
            }
        };

        // Get home dir on load
        const initialize = async () => {
            try {
                const res = await fetch(`/home-dir?token=${props.authToken}`);
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
            isCollapsed, toggleCollapse, currentPath, 
            currentPath, fileList, isLoading,
            selectedFiles, missingFiles, filterQuery, filteredFiles,
            openFolder, goUp, toggleSelection, removeSelected, removeMissing
        };
    },
    template: /* html */ `
        <div class="input-file-wrapper" style="background-color: #f5f5f5; border: 1px solid #dbdbdb; border-radius: 4px;">
            <button style="width: 100%; text-align: left; background: transparent; border: none; padding: 0.75rem; cursor: pointer;"
                    @click="toggleCollapse">
                <span v-if="isCollapsed">
                    ▶ 
                    <span style="display: inline-block; background: gray; color: white; border-radius: 999px; padding: 0.12rem 0.45rem; margin-left: 0.5rem; font-size: 0.8rem; font-weight: 600;">
                        {{ selectedFiles.size }}
                    </span>
                    <span v-if="missingFiles.size > 0" class="has-background-danger" style="display: inline-block; color: white; border-radius: 999px; padding: 0.12rem 0.45rem; margin-left: 0.5rem; font-size: 0.8rem; font-weight: 600;">
                        {{ missingFiles.size }}
                    </span>
                    <span class="ml-2">Select Input Files</span>
                </span>
                <span v-else>▼ &nbsp;You can mention selected files by name in the plainbook, the code generator will know where to find them.</span>
            </button>

            <div v-if="!isCollapsed" style="display: flex; border-top: 1px solid #dbdbdb; height: 400px; background: white;">
                <div style="flex: 1; border-right: 1px solid #dbdbdb; display: flex; flex-direction: column;">
                    <div style="padding: 8px; background: #eee; display: flex; gap: 8px;">
                        <input type="text" v-model="filterQuery" placeholder="Filter files..." 
                            style="flex: 1; padding: 4px; border: 1px solid #ccc;">
                    </div>
                    <div style="padding: 0.25rem; background: #eee; display: flex; gap: 10px; align-items: center;">
                        <button @click="goUp" :disabled="currentPath === '/'" class="button is-light">Up</button>
                        <code style="font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ currentPath }}</code>
                    </div>                    
                    <div style="overflow-y: auto; flex: 1;">
                        <div v-if="isLoading" style="padding: 1rem; color: #888;">Loading...</div>
                        <ul v-else style="list-style: none; margin: 0; padding: 0;">
                            <li v-for="item in filteredFiles" :key="item.path" 
                                style="padding: 0.4rem 0.75rem; border-bottom: 1px solid #fafafa; display: flex; align-items: center; gap: 8px;">
                                
                                <input type="checkbox" 
                                       v-if="item.type === 'file'"
                                       :checked="selectedFiles.has(item.path)"
                                       @change="toggleSelection(item)">
                                
                                <span v-if="item.type === 'directory'" style="color: #f39c12;">📁</span>
                                <span v-else style="color: #656565ff;">📄</span>

                                <span v-if="item.type === 'directory'" 
                                      @click="openFolder(item)"
                                      style="cursor: pointer; color: #3273dc; font-weight: 500;">
                                    {{ item.name }}/
                                </span>
                                <span v-else>{{ item.name }}</span>
                            </li>
                        </ul>
                    </div>
                </div>

                <div style="width: 300px; background: #fafafa; display: flex; flex-direction: column;">
                    <div style="padding: 0.5rem; font-weight: bold; background: #eee;">Selected Files ({{ selectedFiles.size }})</div>
                    <div style="overflow-y: auto; flex: 1; padding: 0.5rem;">
                        <div v-if="selectedFiles.size === 0" style="color: #ccc; font-style: italic;">No files selected</div>
                        <ul style="list-style: none; margin: 0; padding: 0;">
                            <li v-for="[path, file] in selectedFiles" :key="path"
                                style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px; font-size: 0.95rem; background: white; padding: 6px; border-radius: 4px; border: 1px solid #eee;">
                                <button @click="removeSelected(path)" class="delete has-background-danger is-small" style="margin-top: 4px;">
                                </button>
                                <div style="display: flex; flex-direction: column; min-width: 0;">
                                    <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: #222;" :title="path">
                                        {{ file.name }}
                                    </div>
                                    <div style="color: #3273dc; font-size: 0.8rem; margin-top: 2px; white-space: normal; word-break: break-all;">
                                        {{ path }}
                                    </div>
                                </div>
                            </li>
                        </ul>
                    </div>
                    <div v-if="missingFiles.size > 0" style="padding: 0.5rem; font-weight: bold; background: #eee;" class="has-text-danger">Missing Files ({{ missingFiles.size }})</div>
                    <div v-if="missingFiles.size > 0" style="overflow-y: auto; flex: 1; padding: 0.5rem;">
                        <ul style="list-style: none; margin: 0; padding: 0;">
                            <li v-for="[path, file] in missingFiles" :key="path" 
                                style="display: flex; align-items: center; margin-bottom: 4px; font-size: 0.85rem; background: white; padding: 4px; border-radius: 3px; border: 1px solid #eee;">
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
        </div>
    `
};
