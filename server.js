const fs = require("fs")
const path = require("path")
const compression = require("compression")
const express = require("express")
const app = express()

const favicon = require('serve-favicon')

const resolve = (file) => path.resolve(__dirname, file)

const config = require("./config")
const isProduction = config.isProduction

const template = fs.readFileSync(resolve("./src/index.template.html"), "utf-8")

const createRenderer = (bundle, options) => {
	// https://github.com/vuejs/vue/blob/dev/packages/vue-server-renderer/README.md#why-use-bundlerenderer
	return require("vue-server-renderer").createBundleRenderer(bundle, Object.assign(options, {
		template,
		cache: require("lru-cache")({
			max: 1000,
			maxAge: 1000 * 60 * 15
		}),
		// this is only needed when vue-server-renderer is npm-linked
		basedir: resolve("./dist"),
		// recommended for performance
		runInNewContext: false
	}))
}

const serve = (path, cache) => express.static(resolve(path), {
	maxAge: cache && isProduction ? 60 * 60 * 24 * 30 : 0
})

let renderer
let readyPromise
if (isProduction) {
	// In production: create server renderer using built server bundle.
	// The server bundle is generated by vue-ssr-webpack-plugin.
	const bundle = require("./dist/vue-ssr-server-bundle.json")
	// The client manifests are optional, but it allows the renderer
	// to automatically infer preload/prefetch links and directly add <script>
	// tags for any async chunks used during render, avoiding waterfall requests.
	const clientManifest = require("./dist/vue-ssr-client-manifest.json")
	renderer = createRenderer(bundle, {
		clientManifest
	})
	readyPromise = Promise.resolve()
} else {
	// In development: setup the dev server with watch and hot-reload,
	// and create a new renderer on bundle / index template update.
	readyPromise = require("./build/setup-dev-server")(app, (bundle, options) => {
		renderer = createRenderer(bundle, options)
	})
}

const render = (req, res) => {
	const s = Date.now()

	res.setHeader("Content-Type", "text/html")

	const errorHandler = (err) => {
		if (err && err.code === 404) {
			res.status(404).end("404 | Page Not Found")
		} else {
			// Render Error Page or Redirect
			res.status(500).end("500 | Internal Server Error")
			console.error(`Error during render : ${req.url}`)
			console.error(err)
		}
	}

	const context = {
		meta: {
			title: "Default Title",
			description: "Default description"
		},
		url: req.url
	}

	console.log(`Rendering: ${req.url}`)
	renderer.renderToStream(context)
		.on("end", () => console.log(`Whole request: ${Date.now() - s}ms`))
		.on("error", errorHandler)
		.pipe(res)
}

app.use(compression({ threshold: 0 }))
app.use(favicon('./static/favicon.png'))

app.use("/dist", serve("./dist", true))
app.use("/service-worker.js", serve("./dist/service-worker.js"))
app.use("/manifest.json", serve("./static/manifest.json", true))


app.get("*", isProduction ? render : (req, res) => {
	readyPromise.then(() => render(req, res))
})

const port = config.server.port
let server = app.listen(port, () => {
	console.log(`Server started at localhost:${port}`)
})

module.exports = {
	ready: readyPromise,
	close: () => {
		server.close()
	}
}
