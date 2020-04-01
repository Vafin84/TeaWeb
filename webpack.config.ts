import * as ts from "typescript";
import trtransformer, {Config} from "./tools/trgen/ts_transformer";

const path = require('path');
const webpack = require("webpack");
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const ManifestGenerator = require("./webpack/ManifestPlugin");
const WorkerPlugin = require('worker-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

let isDevelopment = process.env.NODE_ENV === 'development';
isDevelopment = true;
export = {
    entry: {}, /* will be individually set */

    devtool: isDevelopment ? "inline-source-map" : undefined,
    mode: isDevelopment ? "development" : "production",
    plugins: [
        new CleanWebpackPlugin(),
        new MiniCssExtractPlugin({
            filename: isDevelopment ? '[name].css' : '[name].[hash].css',
            chunkFilename: isDevelopment ? '[id].css' : '[id].[hash].css'
        }),
        new ManifestGenerator({
            file: path.join(__dirname, "dist/manifest.json")
        }),
        new WorkerPlugin(),
        //new BundleAnalyzerPlugin()
        /*
        new CircularDependencyPlugin({
            //exclude: /a\.js|node_modules/,
            failOnError: true,
            allowAsyncCycles: false,
            cwd: process.cwd(),
        })
         */
        isDevelopment ? undefined : new webpack.optimize.AggressiveSplittingPlugin({
            minSize: 1024 * 8,
            maxSize: 1024 * 128
        })
    ].filter(e => !!e),
    module: {
        rules: [
            {
                test: /\.s[ac]ss$/,
                loader: [
                    isDevelopment ? 'style-loader' : MiniCssExtractPlugin.loader,
                    {
                        loader: 'css-loader',
                        options: {
                            modules: true,
                            sourceMap: isDevelopment
                        }
                    },
                    {
                        loader: 'sass-loader',
                        options: {
                            sourceMap: isDevelopment
                        }
                    }
                ]
            },
            {
                test: /\.tsx?$/,
                exclude: /node_modules/,

                loader: [
                    {
                        loader: 'ts-loader',
                        options: {
                            transpileOnly: true,
                            getCustomTransformers: (prog: ts.Program) => {
                                return {
                                    before: [trtransformer(prog, {})]
                                };
                            }
                        }
                    }
                ]
            },
            {
                test: /\.was?t$/,
                loader: [
                    "./webpack/WatLoader.js"
                ]
            }
        ],
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js', ".scss"],
        alias: { }, /* will be individually set */
    },
    externals: {
        "tc-loader": "window loader"
    },
    output: {
        filename: isDevelopment ? '[name].js' : '[contenthash].js',
        path: path.resolve(__dirname, 'dist'),
        publicPath: "js/"
    },
    optimization: {
        splitChunks: { },
        minimize: !isDevelopment,
        minimizer: [new TerserPlugin()]
    }
};