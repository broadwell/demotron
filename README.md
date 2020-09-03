This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app) but uses [Parcel.js](https://parceljs.org/) to bundle the web application.

## Building instructions

1. Sync the `viewer_sync` branch of this repository
1. In the `demotron/src/` folder, sync the `viewer_sync` branch of [this fork](https://github.com/broadwell/react-iiif-viewer/tree/viewer_sync) of **react-iiif-viewer**.
1. Symlink the `demotron/node_modules/` into `demotron/src/react-iiif-viewer/`:  
`ln -s demotron/node_modules demotron/src/react-iiif-viewer/.`
1. Build the app:  
`yarn start`

## Available Scripts

In the project directory, you can run:

### `yarn start`

Runs the app in the development mode.<br />
Open [http://localhost:1234](http://localhost:1234) to view it in the browser.

The page will reload if you make edits.<br />
You will also see any lint errors in the console.

### `yarn build`

Builds the app for production to the `dist` folder.<br />
It correctly bundles React in production mode and optimizes the build for the best performance.
