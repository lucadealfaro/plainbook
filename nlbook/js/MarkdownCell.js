
const MarkdownCell = {
    props: ['source'],
    setup(props) {
        const md = new markdownit({ html: true });
        const content = Array.isArray(props.source) ? props.source.join('') : props.source;
        return { rendered: md.render(content) };
    },
    template: /* html */ `<div class="markdown-body content p-2" v-html="rendered"></div>`
};

export default MarkdownCell;
