// OutputRenderer.js

export default {
    props: ['output'],
    methods: {
        join(src) { return Array.isArray(src) ? src.join('') : src; }
    },
    template: /* html */ `
        <div class="output-zone mb-2">
            <div class="output-container mt-1">
                <pre v-if="output.output_type === 'stream'" 
                :class="output.name === 'stderr' ? 'has-text-danger has-background-danger-light p-2' : 'has-text-dark'"
                class="output-stream is-family-monospace is-size-7 whitespace-pre-wrap">{{ join(output.text) }}</pre>
                
                <div v-else-if="output.data">
                <div v-if="output.data['text/html']" v-html="join(output.data['text/html'])"></div>
                <figure v-else-if="output.data['image/png']" class="image output-image"
                        style="display: inline-block; max-width: 100%; width: auto;">
                    <img :src="'data:image/png;base64,' + output.data['image/png']"
                         style="max-width: 100%; height: auto; display: block;">
                </figure>
                <pre v-else-if="output.data['text/plain']" class="output-text has-text-grey is-size-7 is-family-monospace">{{ join(output.data['text/plain']) }}</pre>
                </div>
            </div>
        </div>
    `
};
