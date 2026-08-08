const beautify = require("js-beautify");

/**
 * Reformats a full HTML document (with inline <style>/<script>) so the
 * typing animation records readable, indented code even when the source
 * cell is minified/single-line (common for compact CSS snippets copied
 * from a spreadsheet). js-beautify's `html` function recurses into
 * <style>/<script> blocks and beautifies them with its css/js beautifiers
 * too, so this is a single call.
 */
function prettifyCode(code) {
  return beautify.html(code, {
    indent_size: 2,
    indent_char: " ",
    wrap_line_length: 0,
    preserve_newlines: false,
    max_preserve_newlines: 0,
    indent_inner_html: true,
    css: { indent_size: 2 },
    js: { indent_size: 2 },
  });
}


module.exports = { prettifyCode };