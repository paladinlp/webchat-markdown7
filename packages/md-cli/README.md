# md-cli

A powerful yet simple tool for rendering Markdown documents locally during development.

## Installation

To get started with `md-cli`, you can install it either globally or locally, depending on your needs.

### Install locally

If you only need it for a specific project, you can install it locally by running:

```bash
npm install @doocs/md-cli
```

### Install globally

For global access across all your projects, install it globally with:

```bash
npm install -g @doocs/md-cli
```

## Usage

Once installed, running `md-cli` is a breeze. Here’s how to get started:

### Default setup

To launch `md-cli` with the default settings, simply run:

```bash
md-cli
```

### Custom port

If you prefer to run `md-cli` on a different port, say `8899`, just specify it like this:

```bash
md-cli port=8899
```

## Gemini Image + Ali OSS

When using the Gemini image generation endpoint (`/images/generations`), the server uploads images to Ali OSS and returns the OSS URL.

Environment variables:
- `GEMINI_API_KEY`
- `GEMINI_IMAGE_MODEL` (optional, default: `gemini-3-pro-image-preview`)
- `ALI_OSS_REGION`
- `ALI_OSS_BUCKET`
- `ALI_OSS_ACCESS_KEY_ID`
- `ALI_OSS_ACCESS_KEY_SECRET`
- `ALI_OSS_CDN_HOST` (optional)
- `ALI_OSS_PATH` (optional, default: `ai-images`)

## Maintainers

- [yanglbme](https://github.com/yanglbme) – Core maintainer.
- [YangFong](https://github.com/yangfong) – Core maintainer.
- [xw](https://github.com/wll8) – Contributor.
- [thinkasany](https://www.npmjs.com/~thinkerwing) – Contributor.
