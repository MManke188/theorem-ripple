// The parts of d3 that js/app.js uses. js/vendor/d3.min.js is built from this list and is
// a third the size of the full library. A d3 function that is not listed here does not
// exist on the page: add it, then build again (in an empty folder outside the repository):
//
//   npm install d3@7.9.0 esbuild
//   NODE_PATH=$PWD/node_modules npx esbuild <repo>/tools/d3-entry.js --bundle --minify --format=iife --global-name=d3 \
//     --banner:js="// d3 v7.9.0, only the parts listed in tools/d3-entry.js. https://d3js.org Copyright 2010-2023 Mike Bostock, ISC license" \
//     --outfile=<repo>/js/vendor/d3.min.js
import 'd3-transition'; // adds .transition() to selections
export { select, create } from 'd3-selection';
export { zoom, zoomIdentity } from 'd3-zoom';
export { range } from 'd3-array';
export { easeCubicInOut } from 'd3-ease';
