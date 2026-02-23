let match = "gment <b>con</b>tain";
let res = match.replace(/(^|>)([^<]+)(<|$)/g, (m, p1, text, p3) => {
    return `${p1}<MARK>${text}</MARK>${p3}`;
});
console.log(res);

let match2 = "<b>hello</b>";
let res2 = match2.replace(/(^|>)([^<]+)(<|$)/g, (m, p1, text, p3) => {
    return `${p1}<MARK>${text}</MARK>${p3}`;
});
console.log(res2);
