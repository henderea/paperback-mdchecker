import path from 'path';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin';
import ansiEscapes from 'ansi-escapes';
import webpack from 'webpack';
import { fileURLToPath } from 'url';

const { ProgressPlugin } = webpack;

const dirname = path.dirname(fileURLToPath(import.meta.url));

const mode = process.env.NODE_ENV || 'production';
const showProgress = process.env.SHOW_PROGRESS != 'false';

const cacheVersionNumber = '1'; // increment this to reset cache. cache should be reset after major NodeJS dependency updates
const cacheVersionPrefix = mode == 'production' ? '' : 'dev-';
const cacheVersion = `${cacheVersionPrefix}${cacheVersionNumber}`;
const cache = {
  type: 'filesystem',
  version: cacheVersion,
  idleTimeoutForInitialStore: 0,
  idleTimeoutAfterLargeChanges: 0
};

const plugins = [
  new MiniCssExtractPlugin({
    filename: 'css/[name].css'
  })
];

if(showProgress) {
  plugins.push(new ProgressPlugin((percentage, message, ..._args) => {
    let percentDisplay = `${Math.round(percentage * 100)}%`.padStart(4, ' ');
    process.stdout.write(`${ansiEscapes.cursorLeft}${ansiEscapes.eraseLine} \u001B[1m${percentDisplay}\u001B[0m${message ? ` - ${message}` : ''}${ansiEscapes.cursorLeft}`);
  }));
}

export default {
  mode,
  devtool: 'source-map',
  entry: {
    'unknown-titles': './src/unknown-titles.ts',
    'update-check': './src/update-check.ts',
    'all-info': './src/all-info.ts'
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: path.join(dirname, 'tsconfig.json')
          }
        }
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/env'],
            plugins: [['@babel/transform-runtime', { regenerator: true }]]
          }
        }
      },
      {
        test: /\.scss$/,
        exclude: /node_modules/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              importLoaders: 1,
              sourceMap: true,
            }
          },
          {
            loader: 'postcss-loader',
            options: {
              postcssOptions: {
                plugins: ['postcss-preset-env']
              },
              sourceMap: true
            }
          },
          {
            loader: 'sass-loader',
            options: {
              sassOptions: {
                style: 'compressed'
              },
              sourceMap: true
            }
          }
        ]
      }
    ]
  },
  output: {
    // library: {
    //   type: 'window'
    // },
    assetModuleFilename: 'assets/[name][ext]',
    clean: true,
    filename: 'js/[name].js',
    path: path.resolve(dirname, 'public/generated')
  },
  resolve: {
    alias: {
      lib: path.resolve(dirname, './lib'),
      nm: path.resolve(dirname, './node_modules')
    },
    extensions: ['.js', '.ts', '.json'],
    plugins: [
      new TsconfigPathsPlugin({ configFile: path.join(dirname, 'tsconfig.json') })
    ]
  },
  stats: {
    excludeAssets: [/node_modules/],
    excludeModules: [/node_modules/],
    modules: false
  },
  performance: {
    maxAssetSize: 10 * 1000 * 1000,
    maxEntrypointSize: 10 * 1000 * 1000,
    hints: false
  },
  cache,
  plugins
};
