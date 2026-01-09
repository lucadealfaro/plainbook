export default {
    props: ['isLocked', 'running', 'hasNotebook', 'lastRunIndex', 'cellCount', 'hasApiKey'],
    emits: [
        'lock', 'refresh', 'interrupt', 'regenerate-all', 
        'reset-run-all', 'open-info', 'open-settings'
    ],
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

                        <button v-if="!running && hasNotebook && lastRunIndex >= cellCount - 1"
                                class="button is-light" title="All cells have been run">
                            <span class="icon"><i class="fa fa-check-circle"></i></span>
                            <span>Up to Date</span>
                        </button>

                        <button v-if="!running && hasNotebook"
                            :disabled="cellCount === 0 || isLocked"
                            @click="$emit('regenerate-all')" 
                            title="Regenerate all code from descriptions"
                            class="button is-success">
                            <span class="icon"><i class="fa fa-repeat"></i></span>
                            <span>Regenerate All</span>
                        </button>

                        <button v-if="!running && hasNotebook"
                            :disabled="cellCount === 0"
                            @click="$emit('reset-run-all')" 
                            title="Reset and run all cells"
                            class="button is-primary">
                            <span class="icon"><i class="fa fa-play"></i></span>
                            <span>Reset and Run All</span>
                        </button>
                    </div>
                </div>
            </div>
            <div class="navbar-end">
                <div class="navbar-item">
                    <div class="buttons">
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