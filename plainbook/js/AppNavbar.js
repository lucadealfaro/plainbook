export default {
    props: ['isLocked', 'running', 'runningActivity', 'hasNotebook', 'upToDate', 'cellCount', 'hasApiKey', 'debug',
            'activeAiProvider', 'availableAiProviders'],
    emits: [
        'lock', 'refresh', 'interrupt', 'regenerate-all',
        'reset-run-all', 'run-all', 'run-all-tests', 'clear-outputs', 'open-info', 'open-settings', 'debug-request',
        'set-ai-provider'
        ],
    data() {
        return { aiDropdownOpen: false };
    },
    computed: {
        activeProviderName() {
            if (!this.availableAiProviders || this.availableAiProviders.length === 0) return 'No AI Keys';
            const active = this.availableAiProviders.find(p => p.id === this.activeAiProvider);
            return active ? active.name : 'No AI';
        },
        canSwitchProvider() {
            return this.availableAiProviders && this.availableAiProviders.length >= 2;
        },
        groupedProviders() {
            if (!this.availableAiProviders) return [];
            const groups = [];
            let lastMajor = null;
            for (const p of this.availableAiProviders) {
                const major = p.major || p.id;
                if (major !== lastMajor) {
                    groups.push({ type: 'header', label: major.charAt(0).toUpperCase() + major.slice(1) });
                    lastMajor = major;
                }
                groups.push({ type: 'item', provider: p });
            }
            return groups;
        },
    },
    methods: {
        toggleDropdown() {
            if (!this.canSwitchProvider) return;
            this.aiDropdownOpen = !this.aiDropdownOpen;
        },
        selectProvider(id) {
            this.$emit('set-ai-provider', id);
            this.aiDropdownOpen = false;
        },
    },
    mounted() {
        this._onDocClick = (e) => {
            if (this.$refs.aiDropdown && !this.$refs.aiDropdown.contains(e.target)) {
                this.aiDropdownOpen = false;
            }
        };
        document.addEventListener('click', this._onDocClick);
    },
    beforeUnmount() {
        document.removeEventListener('click', this._onDocClick);
    },
    template: /* html */ `
    <div class="app-toolbar has-background-dark"
         style="display: flex; flex-wrap: wrap; align-items: center;
                padding: 0.4rem 0.4rem; gap: 0.2rem;"
         role="navigation" aria-label="main navigation">
        <div class="buttons mb-0">

                        <button v-if="isLocked" class="button is-warning" title="Unlock Notebook" @click="$emit('lock', false)">
                        <span class="icon"><i class="bx bx-lock"></i></span>
                        </button>
                        <button v-else class="button is-light" title="Lock Notebook" @click="$emit('lock', true)">
                        <span class="icon"><i class="bx bx-lock-open"></i></span>
                        </button>

                        <button v-if="!running && hasNotebook"
                            :disabled="cellCount === 0"
                            @click="$emit('clear-outputs')"
                            title="Clear all outputs"
                            class="button is-light">
                            <span class="icon"><i class="bx bx-broom"></i></span>
                            <span>Clear outputs</span>
                        </button>

                        <!-- <button v-if="!running && hasNotebook"
                            @click="$emit('refresh')"
                            class="button is-light" title="Reload Notebook">
                            <span class="icon"><i class="bx bx-refresh-cw"></i></span>
                            <span>Refresh</span>
                        </button> -->

                        <button v-if="running && hasNotebook"
                                @click="$emit('interrupt')"
                                class="button is-danger" title="Interrupt Execution">
                            <span class="icon">
                                <i :class="runningActivity && runningActivity.type === 'generating'
                                    ? 'bx bx-cognition'
                                    : 'bx bx-running'"></i>
                            </span>
                            <span v-if="runningActivity && runningActivity.type === 'generating'">
                                Generating cell {{ runningActivity.cellIndex + 1 }}
                            </span>
                            <span v-else-if="runningActivity && runningActivity.type === 'running'">
                                Running cell {{ runningActivity.cellIndex + 1 }}
                            </span>
                            <span v-else>Running...</span>
                        </button>

                        <!-- <button v-if="!running && upToDate"
                                class="button is-light" title="All cells have been run">
                            <span class="icon"><i class="bx bx-check-circle"></i></span>
                            <span>Up to Date</span>
                        </button> -->

                        <!-- <button v-if="!running && hasNotebook"
                            :disabled="cellCount === 0 || isLocked"
                            @click="$emit('regenerate-all')"
                            title="Regenerate all code from descriptions"
                            class="button is-success">
                            <span class="icon"><i class="bx bx-repeat"></i></span>
                            <span>Regenerate All</span>
                        </button> -->

                        <button v-if="!running && hasNotebook"
                            :disabled="cellCount === 0"
                            @mousedown.prevent
                            @click="$emit('reset-run-all')"
                            title="Reset and run all cells"
                            class="button is-primary">
                            <span class="icon">
                                <i class="bx bx-keyframe-ease-in"></i>
                            </span>
                            <span>Run from the beginning</span>
                        </button>

                        <button v-if="!running && hasNotebook"
                            :disabled="cellCount === 0"
                            @mousedown.prevent
                            @click="$emit('run-all')"
                            title="Run all"
                            class="button is-primary">
                            <span class="icon"><i class="bx bx-play"></i></span>
                            <span>Run</span>
                        </button>

                        <button v-if="!running && hasNotebook"
                            :disabled="cellCount === 0"
                            @mousedown.prevent
                            @click="$emit('run-all-tests')"
                            title="Run all tests"
                            class="button is-warning">
                            <span class="icon"><i class="bx bx-seal-check"></i></span>
                            <span>Run tests</span>
                        </button>

        </div>
        <span style="flex: 1;"></span>
        <div class="buttons mb-0">
                        <button v-if="debug" class="button is-warning" title="Send debug request" @click="$emit('debug-request')">
                            <span class="icon"><i class="bx bx-bug"></i></span>
                            <span>Debug</span>
                        </button>
                        <div ref="aiDropdown">
                            <div class="dropdown" :class="{'is-active': aiDropdownOpen}">
                                <div class="dropdown-trigger">
                                    <button class="button is-light"
                                            :disabled="!availableAiProviders || availableAiProviders.length === 0"
                                            @click.stop="toggleDropdown"
                                            :title="canSwitchProvider ? 'Select AI Provider' : activeProviderName">
                                        <span class="icon is-small"><i class="bx bx-light-bulb"></i></span>
                                        <span>{{ activeProviderName }}</span>
                                        <span v-if="canSwitchProvider" class="icon is-small">
                                            <i class="bx bx-chevron-down"></i>
                                        </span>
                                    </button>
                                </div>
                                <div class="dropdown-menu" role="menu" v-if="canSwitchProvider">
                                    <div class="dropdown-content">
                                        <template v-for="(entry, idx) in groupedProviders" :key="idx">
                                            <hr v-if="entry.type === 'header' && idx > 0" class="dropdown-divider">
                                            <p v-if="entry.type === 'header'" class="dropdown-item has-text-weight-bold" style="cursor: default; font-size: 0.8em; text-transform: uppercase; color: #999;">
                                                {{ entry.label }}
                                            </p>
                                            <a v-if="entry.type === 'item'"
                                                class="dropdown-item" :class="{'is-active': entry.provider.id === activeAiProvider}"
                                                @click.prevent="selectProvider(entry.provider.id)">
                                                {{ entry.provider.name }}
                                            </a>
                                        </template>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <button class="button is-light" @click="$emit('open-info')" title="About Plainbook">
                            <span class="icon"><i class="bx bx-info-circle"></i></span>
                        </button>
                        <button class="button" :class="hasApiKey ? 'is-light' : 'is-warning'"
                                @click="$emit('open-settings')" title="Settings">
                            <span class="icon"><i :class="hasApiKey ? 'bx bx-cog' : 'bx bx-alert-triangle'"></i></span>
                            <span>Settings</span>
                        </button>
        </div>
    </div>`
};
