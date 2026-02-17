export default {
    props: ['isLocked', 'running', 'hasNotebook', 'upToDate', 'cellCount', 'hasApiKey', 'debug',
            'activeAiProvider', 'availableAiProviders'],
    emits: [
        'lock', 'refresh', 'interrupt', 'regenerate-all',
        'reset-run-all', 'run-all','open-info', 'open-settings', 'debug-request',
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
    <nav class="navbar is-dark is-fixed-top" role="navigation" aria-label="main navigation">
        <div id="the-navbar-menu" class="navbar-menu">
            <div class="navbar-start">
                <div class="navbar-item">
                    <div class="buttons">
                        <button v-if="isLocked" class="button is-warning" title="Unlock Notebook" @click="$emit('lock', false)">
                            <span class="icon"><i class="fa fa-lock"></i></span>
                        </button>
                        <button v-else class="button is-light" title="Lock Notebook" @click="$emit('lock', true)">
                            <span class="icon"><i class="fa fa-unlock"></i></span>
                        </button>

                        <button v-if="!running && hasNotebook"
                            @click="$emit('refresh')"
                            class="button is-light" title="Reload Notebook">
                            <span class="icon"><i class="fa fa-refresh"></i></span>
                            <span>Refresh</span>
                        </button>

                        <button v-if="running && hasNotebook"
                                @click="$emit('interrupt')"
                                class="button is-danger" title="Interrupt Execution">
                            <span class="icon"><i class="fa fa-stop"></i></span>
                            <span>Running...</span>
                        </button>

                        <!-- <button v-if="!running && upToDate"
                                class="button is-light" title="All cells have been run">
                            <span class="icon"><i class="fa fa-check-circle"></i></span>
                            <span>Up to Date</span>
                        </button> -->

                        <!-- <button v-if="!running && hasNotebook"
                            :disabled="cellCount === 0 || isLocked"
                            @click="$emit('regenerate-all')"
                            title="Regenerate all code from descriptions"
                            class="button is-success">
                            <span class="icon"><i class="fa fa-repeat"></i></span>
                            <span>Regenerate All</span>
                        </button> -->

                        <button v-if="!running && hasNotebook"
                            :disabled="cellCount === 0"
                            @mousedown.prevent
                            @click="$emit('reset-run-all')"
                            title="Reset and run all cells"
                            class="button is-primary">
                            <span class="icon px-4">
                                    <i class="fa fa-repeat mr-1"></i>
                                    <i class="fa fa-play"></i>
                            </span>
                            <span>Run from the beginning</span>
                        </button>

                        <button v-if="!running && hasNotebook"
                            :disabled="cellCount === 0"
                            @mousedown.prevent
                            @click="$emit('run-all')"
                            title="Run all"
                            class="button is-primary">
                            <span class="icon"><i class="fa fa-play"></i></span>
                            <span>Run</span>
                        </button>

                    </div>
                </div>
            </div>
            <div class="navbar-end">
                <div class="navbar-item" ref="aiDropdown">
                    <div class="dropdown" :class="{'is-active': aiDropdownOpen}">
                        <div class="dropdown-trigger">
                            <button class="button is-light"
                                    :disabled="!availableAiProviders || availableAiProviders.length === 0"
                                    @click.stop="toggleDropdown"
                                    :title="canSwitchProvider ? 'Select AI Provider' : activeProviderName">
                                <span class="icon is-small"><i class="fa fa-lightbulb-o"></i></span>
                                <span>{{ activeProviderName }}</span>
                                <span v-if="canSwitchProvider" class="icon is-small">
                                    <i class="fa fa-angle-down"></i>
                                </span>
                            </button>
                        </div>
                        <div class="dropdown-menu" role="menu" v-if="canSwitchProvider">
                            <div class="dropdown-content">
                                <a v-for="provider in availableAiProviders" :key="provider.id"
                                   class="dropdown-item" :class="{'is-active': provider.id === activeAiProvider}"
                                   @click.prevent="selectProvider(provider.id)">
                                    {{ provider.name }}
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="navbar-item">
                    <div class="buttons">
                        <button v-if="debug" class="button is-warning" title="Send debug request" @click="$emit('debug-request')">
                            <span class="icon"><i class="fa fa-bug"></i></span>
                            <span>Debug</span>
                        </button>
                        <button class="button is-light" @click="$emit('open-info')" title="About Plainbook">
                            <span class="icon"><i class="fa fa-info"></i></span>
                        </button>
                        <button class="button" :class="hasApiKey ? 'is-light' : 'is-warning'"
                                @click="$emit('open-settings')" title="Settings">
                            <span class="icon"><i :class="hasApiKey ? 'fa fa-cog' : 'fa fa-warning'"></i></span>
                            <span>Settings</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </nav>`
};