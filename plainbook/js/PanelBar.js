import { ref } from './vue.esm-browser.js';
import InputFile from './InputFile.js';
import InstructionsPanel from './InstructionsPanel.js';

export default {
    props: ['authToken'],
    components: { InputFile, InstructionsPanel },
    setup() {
        const activeTab = ref(null);
        const selectedCount = ref(0);
        const missingCount = ref(0);

        const toggleTab = (name) => {
            activeTab.value = activeTab.value === name ? null : name;
        };

        const onFileCounts = ({ selected, missing }) => {
            selectedCount.value = selected;
            missingCount.value = missing;
        };

        return { activeTab, toggleTab, selectedCount, missingCount, onFileCounts };
    },
    template: /* html */ `
        <div style="background-color: #f5f5f5; border: 1px solid #dbdbdb; border-radius: 4px;">
            <div style="display: flex; align-items: stretch; background: transparent; padding: 0;">
                <button class="button is-ghost"
                    @click="toggleTab('files')"
                    style="border: none; border-radius: 0; border-bottom: 2px solid transparent; text-decoration: none;"
                    :style="activeTab === 'files' ? 'font-weight: 700; border-bottom-color: #3273dc; color: #3273dc;' : 'color: #555;'"
                >
                    <span class="icon is-small"><i class="bx bx-folder"></i></span>
                    <span>Files</span>
                    <span style="display: inline-block; background: gray; color: white; border-radius: 999px; padding: 0.12rem 0.45rem; margin-left: 0.4rem; font-size: 0.8rem; font-weight: 600;">
                        {{ selectedCount }}
                    </span>
                    <span v-if="missingCount > 0" class="has-background-danger" style="display: inline-block; color: white; border-radius: 999px; padding: 0.12rem 0.45rem; margin-left: 0.3rem; font-size: 0.8rem; font-weight: 600;">
                        {{ missingCount }}
                    </span>
                </button>
                <div style="width: 1px; background: #dbdbdb; align-self: stretch; margin: 0.4rem 0;"></div>
                <button class="button is-ghost"
                    @click="toggleTab('instructions')"
                    style="border: none; border-radius: 0; border-bottom: 2px solid transparent; text-decoration: none;"
                    :style="activeTab === 'instructions' ? 'font-weight: 700; border-bottom-color: #3273dc; color: #3273dc;' : 'color: #555;'"
                >
                    <span class="icon is-small"><i class="bx bx-book"></i></span>
                    <span>Instructions</span>
                </button>
            </div>
            <div v-show="activeTab === 'files'" style="border-top: 1px solid #dbdbdb;">
                <input-file :auth-token="authToken" @file-counts="onFileCounts" />
            </div>
            <div v-if="activeTab === 'instructions'" style="border-top: 1px solid #dbdbdb;">
                <instructions-panel :auth-token="authToken" />
            </div>
        </div>
    `
};
