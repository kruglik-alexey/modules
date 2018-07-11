const fs = require('fs');
const path = require('path');
const babylon = require("babylon");
const traverse = require("babel-traverse").default;
const types = require("babel-types");
const generate = require("babel-generator").default;
const template = require("babel-template");

const moduleExports = template('module.exports = EXPORT;');
const requireCall = template('const ID = require(IMPORT);');
const defineCall = template('define(FUNC);');

function getFuncBody(func) {
    // func.body is block statement, so taking its body
    // TODO arrow func?
    return func.body.body;
}

function amdWithTwoArgs(ast) {
    traverse(ast, {
        CallExpression(path) {
            if (path.node.callee.name === 'define' &&
                (path.node.arguments.length == 2) &&
                types.isProgram(path.parentPath.parent)) {

                var array = path.node.arguments[0].elements; // ArrayExpression.elements
                var func = path.node.arguments[1];
                var newArs = [types.identifier('require')];

                var newBody = func.params.map((a, i) => requireCall({
                    ID: a,
                    IMPORT: array[i]
                }));

                newBody = newBody.concat(getFuncBody(func));
                newBody = types.blockStatement(newBody);

                var newFunc = types.functionExpression(null, newArs, newBody);
                var newDefine = defineCall({FUNC: newFunc});

                path.replaceWith(newDefine);
                ast.isChanged = true;
            }
        }
    });
}

function amdWithSingleArg(ast) {
    traverse(ast, {
        CallExpression(path) {
            if (path.node.callee.name === 'define' &&
                (path.node.arguments.length == 1) &&
                types.isProgram(path.parentPath.parent)) {

                var bodyPah = path.get('arguments')[0].get('body');
                bodyPah.traverse({
                    ReturnStatement(path) {
                        if (path.parentPath === bodyPah) {
                            path.replaceWith(moduleExports({
                                EXPORT: path.node.argument
                            }));
                            ast.isChanged = true;
                        }
                    }
                });

                var func = path.node.arguments[0];
                var program = path.parentPath.parent;
                var newBody = program.body.reduce((acc, x) => {
                    if (x === path.parentPath.node) {
                        acc = acc.concat(getFuncBody(func));
                    } else {
                        acc.push(x);
                    }
                    return acc;
                }, []);

                program.body = newBody;
                ast.isChanged = true;
            }
        }
    });
}

function cjsRequire(ast) {
    var imports = [];

    traverse(ast, {
        VariableDeclaration(path) {
            if (path.node.declarations.length === 1 && types.isProgram(path.getStatementParent().parentPath)) {
                var declarationPath = path.get('declarations')[0];
                var initPath = declarationPath.get('init');
                var idPath = declarationPath.get('id');

                if (types.isMemberExpression(initPath) &&
                    initPath.node.property.name === 'default' &&
                    types.isCallExpression(initPath.node.object) &&
                    initPath.node.object.callee.name === 'require') {

                    var imprt = types.importDeclaration(
                        [types.importDefaultSpecifier(idPath.node)],
                        initPath.node.object.arguments[0]);

                    imports.push(imprt);
                    path.remove();
                    ast.isChanged = true;
                }

                if (types.isCallExpression(initPath) && initPath.node.callee.name === 'require') {
                    var imprt;
                    if (types.isObjectPattern(idPath)) {
                        var specifiers = idPath.get('properties').map(p => {
                            return types.importSpecifier(p.get('key').node, p.get('key').node);
                        });
                        imprt = types.importDeclaration(
                            specifiers,
                            initPath.node.arguments[0]);
                    } else {
                        imprt = types.importDeclaration(
                            [types.importDefaultSpecifier(idPath.node)],
                            initPath.node.arguments[0]);
                    }
                    imports.push(imprt);
                    path.remove();
                    ast.isChanged = true;
                }
            }
        },
        CallExpression(path) {
            if (path.node.callee.name == 'require' && !types.isProgram(path.getFunctionParent())) {
                ast.hasInnerRequires = true;
            }
        }
    });

    traverse(ast, {
        Program(path) {
            if (imports !== null) {
                var i = imports;
                imports = null; // brake recursion
                if (i > 0) {
                    path.replaceWith(types.program(i.concat(path.node.body)));
                    ast.isChanged = true;
                }
            }
        }
    });
}

function cjsExports(ast) {
    traverse(ast, {
        AssignmentExpression(path) {
            if (path.node.left.property && path.node.left.property.name === 'exports' && path.node.left.object.name === 'module') {
                // TODO
                if (false && types.isObjectExpression(path.get('right'))) {
                    // parentPath is ExpressionStatement
                    path.parentPath.replaceWith(types.exportAllDeclaration(path.node.right));
                    ast.isChanged = true;
                } else {
                    // parentPath is ExpressionStatement
                    path.parentPath.replaceWith(types.exportDefaultDeclaration(path.node.right));
                    ast.isChanged = true;
                }
            }
        }
    });
}

function transform(code) {
    const ast = babylon.parse(code, {sourceType: 'module', plugins: ["jsx", "objectRestSpread"]});
    amdWithTwoArgs(ast);
    amdWithSingleArg(ast);
    cjsRequire(ast);
    cjsExports(ast);
    return {
        code: ast.isChanged ? generate(ast, {}, code).code : null,
        hasInnerRequires: ast.hasInnerRequires || false,
        isChanged: ast.isChanged
    };
}

function walkSync(dir, filelist = []) {
    fs.readdirSync(dir).forEach(file => {
        const dirFile = path.join(dir, file);
        try {
            filelist = walkSync(dirFile, filelist);
        }
        catch (err) {
            if (err.code === 'ENOTDIR' || err.code === 'EBUSY') filelist = [...filelist, dirFile];
            else throw err;
        }
    });
    return filelist;
}

const file = process.argv[2];

walkSync('c:\\targetprocess\\tp-webpack4\\Code\\Main\\Tp.Web\\JavaScript\\tau\\scripts\\tau\\configurations').forEach(f => {
    if (!f.match(/.*\.js$/)) {
        return;
    }
    if (file && f.indexOf(file) === -1) {
        return;
    }
    fs.readFile(f, function(_, data) {
        try {
            var result = transform(data.toString());
            if (result.isChanged) {
                if (result.hasInnerRequires) {
                    console.log('IRQ', f);
                } else {
                    console.log('TRF', f);
                    fs.writeFile(f, result.code, function() {
                    });
                }
            } else {
                console.log('NOP', f);
            }
        } catch(err) {
            console.log(err);
            console.log('ERR', f);
        }
    });
})
