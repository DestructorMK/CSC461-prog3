/* GLOBAL CONSTANTS AND VARIABLES */

/* assignment specific globals */
const INPUT_TRIANGLES_URL = "https://ncsucgclass.github.io/prog3/triangles2.json"; // triangles file loc
const INPUT_LIGHTS_URL = "https://ncsucgclass.github.io/prog3/lights.json"; // lights file loc
const MAX_LIGHTS = 8; // most lights the fragment shader will sum
var defaultEye = vec3.fromValues(0.5,0.5,-0.5); // default eye position in world space
var defaultLookAt = vec3.fromValues(0,0,1); // default look at direction in world space
var defaultUp = vec3.fromValues(0,1,0); // default view up vector in world space
var lights = [{ // default white light, replaced by the lights file when it loads
    position: [-0.5,1.5,-0.5], ambient: [1,1,1], diffuse: [1,1,1], specular: [1,1,1]
}];

/* view globals */
var Eye = vec3.clone(defaultEye); // current eye position
var LookAt = vec3.clone(defaultLookAt); // current look at direction
var Up = vec3.clone(defaultUp); // current view up vector
var winLeft = -0.5, winRight = 0.5; // window x extents in view space
var winBottom = -0.5, winTop = 0.5; // window y extents in view space
var winNear = 0.5, winFar = 100; // window distance from eye, and far clip distance

/* interaction globals */
const TRANSLATE_STEP = 0.02; // world units moved per key press
const ROTATE_STEP = 2 * Math.PI / 180; // radians turned per key press
const HIGHLIGHT_SCALE = 1.2; // uniform scale applied to the selected model
var selectedModel = -1; // index of the selected model, -1 when nothing is selected

/* webgl globals */
var gl = null; // the all powerful gl object. It's all here folks!
var models = []; // one entry per triangle set: buffers, material and transform state
var useLighting = true; // false renders unlit diffuse color (part 2)
var useVertexNormals = true; // false lights with face normals even when the file has vertex normals

/* shader attribute and uniform locations */
var vertexPositionAttrib; // where to put position for vertex shader
var vertexNormalAttrib; // where to put lighting normal (vertex or face) for vertex shader
var vertexFaceNormalAttrib; // where to put face normal for vertex shader, used to pick the lit side
var modelMatrixULoc, viewMatrixULoc, projMatrixULoc, normalMatrixULoc; // transforms
var eyePositionULoc, lightingULoc; // eye location and lighting on/off flag
var numLightsULoc, lightPositionULoc, lightAmbientULoc, lightDiffuseULoc, lightSpecularULoc; // lights
var ambientULoc, diffuseULoc, specularULoc, shininessULoc; // material


// ASSIGNMENT HELPER FUNCTIONS

// get the JSON file from the passed URL
function getJSONFile(url,descr) {
    try {
        if ((typeof(url) !== "string") || (typeof(descr) !== "string"))
            throw "getJSONFile: parameter not a string";
        else {
            var httpReq = new XMLHttpRequest(); // a new http request
            httpReq.open("GET",url,false); // init the request
            httpReq.send(null); // send the request
            var startTime = Date.now();
            while ((httpReq.status !== 200) && (httpReq.readyState !== XMLHttpRequest.DONE)) {
                if ((Date.now()-startTime) > 3000)
                    break;
            } // until its loaded or we time out after three seconds
            if ((httpReq.status !== 200) || (httpReq.readyState !== XMLHttpRequest.DONE))
                throw "Unable to open "+descr+" file!";
            else
                return JSON.parse(httpReq.response);
        } // end if good params
    } // end try

    catch(e) {
        console.log(e);
        return(String.null);
    }
} // end get input json file

// set up the webGL environment
function setupWebGL() {

    // Get the canvas and context
    var canvas = document.getElementById("myWebGLCanvas"); // create a js canvas
    gl = canvas.getContext("webgl"); // get a webgl object from it

    try {
      if (gl == null) {
        throw "unable to create gl context -- is your browser gl ready?";
      } else {
        gl.clearColor(0.0, 0.0, 0.0, 1.0); // use black when we clear the frame buffer
        gl.clearDepth(1.0); // use max when we clear the depth buffer
        gl.enable(gl.DEPTH_TEST); // use hidden surface removal (with zbuffering)
      }
    } // end try

    catch(e) {
      console.log(e);
    } // end catch

} // end setupWebGL

// make a webgl array buffer holding the passed float values
function makeArrayBuffer(values) {
    var buffer = gl.createBuffer(); // init empty buffer
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer); // activate that buffer
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.STATIC_DRAW); // values to that buffer
    return buffer;
} // end make array buffer

// read triangles in, load them into webgl buffers
// each triangle gets its own three vertices, so every pixel in it can share the face normal
function loadTriangles() {
    var inputTriangles = getJSONFile(INPUT_TRIANGLES_URL,"triangles");
    if (inputTriangles != String.null) {
        for (var whichSet=0; whichSet<inputTriangles.length; whichSet++) {
            var set = inputTriangles[whichSet];
            var coordArray = []; // vertex coords for this set, three per triangle
            var normalArray = []; // face normal for each of those vertices
            var vertexNormalArray = []; // file's vertex normals, or the face normal when it has none
            var hasNormals = Array.isArray(set.normals) && (set.normals.length === set.vertices.length);
            var center = vec3.create(); // average of the set's vertices

            for (var whichVert=0; whichVert<set.vertices.length; whichVert++)
                vec3.add(center,center,set.vertices[whichVert]);
            vec3.scale(center,center,1/set.vertices.length);

            for (var whichTri=0; whichTri<set.triangles.length; whichTri++) {
                var tri = set.triangles[whichTri];
                var v0 = set.vertices[tri[0]], v1 = set.vertices[tri[1]], v2 = set.vertices[tri[2]];
                var edge1 = vec3.subtract(vec3.create(),v1,v0);
                var edge2 = vec3.subtract(vec3.create(),v2,v0);
                var faceNormal = vec3.normalize(vec3.create(),vec3.cross(vec3.create(),edge1,edge2));
                if (hasNormals) { // winding may disagree with the file's normals, so trust the file
                    var normalSum = vec3.add(vec3.create(),set.normals[tri[0]],set.normals[tri[1]]);
                    vec3.add(normalSum,normalSum,set.normals[tri[2]]);
                    if (vec3.dot(faceNormal,normalSum) < 0) vec3.negate(faceNormal,faceNormal);
                }
                for (var corner=0; corner<3; corner++) {
                    coordArray = coordArray.concat(set.vertices[tri[corner]]);
                    normalArray.push(faceNormal[0],faceNormal[1],faceNormal[2]);
                    var vertexNormal = hasNormals ? vec3.normalize(vec3.create(),set.normals[tri[corner]]) : faceNormal;
                    vertexNormalArray.push(vertexNormal[0],vertexNormal[1],vertexNormal[2]);
                }
            } // end for each triangle in set

            models.push({
                vertexBuffer: makeArrayBuffer(coordArray),
                normalBuffer: makeArrayBuffer(normalArray),
                vertexNormalBuffer: makeArrayBuffer(vertexNormalArray),
                vertexCount: coordArray.length/3,
                material: set.material,
                center: center, // scaling and rotation happen around this point
                translation: vec3.create(), // accumulated translation from the keys
                rotation: mat4.create() // accumulated rotation from the keys
            });
        } // end for each triangle set
    } // end if triangles found
} // end load triangles

// read lights in from the lights file, keeping the default light if it can't be read
function loadLights() {
    var inputLights = getJSONFile(INPUT_LIGHTS_URL,"lights");
    if ((inputLights != String.null) && Array.isArray(inputLights) && (inputLights.length > 0)) {
        if (inputLights.length > MAX_LIGHTS)
            console.log("lights file has "+inputLights.length+" lights, using the first "+MAX_LIGHTS);
        lights = inputLights.slice(0,MAX_LIGHTS).map(function(light) {
            return {
                position: [light.x,light.y,light.z],
                ambient: light.ambient, diffuse: light.diffuse, specular: light.specular
            };
        });
    } // end if lights found
} // end load lights

// setup the webGL shaders
function setupShaders() {

    // define fragment shader in essl using es6 template strings
    // blinn-phong lighting per fragment, or the plain diffuse color when lighting is off
    var fShaderCode = `
        precision mediump float;

        uniform bool uLighting; // whether to light, or show unlit diffuse color
        uniform vec3 uEyePosition; // eye location in world space

        const int MAX_LIGHTS = ${MAX_LIGHTS};
        uniform int uNumLights; // how many of the light slots are in use
        uniform vec3 uLightPosition[MAX_LIGHTS]; // light locations in world space
        uniform vec3 uLightAmbient[MAX_LIGHTS]; // light ambient emissions
        uniform vec3 uLightDiffuse[MAX_LIGHTS]; // light diffuse emissions
        uniform vec3 uLightSpecular[MAX_LIGHTS]; // light specular emissions

        uniform vec3 uAmbient; // material ambient reflectivity
        uniform vec3 uDiffuse; // material diffuse reflectivity
        uniform vec3 uSpecular; // material specular reflectivity
        uniform float uShininess; // material specular exponent

        varying vec3 vWorldPos; // interpolated world position of fragment
        varying vec3 vNormal; // interpolated normal of fragment
        varying vec3 vFaceNormal; // normal of the fragment's triangle

        void main(void) {
            if (!uLighting) {
                gl_FragColor = vec4(uDiffuse, 1.0);
                return;
            }

            vec3 N = normalize(vNormal);
            vec3 V = normalize(uEyePosition - vWorldPos);
            if (dot(vFaceNormal,V) < 0.0) N = -N; // light the side of the triangle facing the eye

            vec3 color = vec3(0.0);
            for (int i=0; i<MAX_LIGHTS; i++) { // loop bound must be constant in essl 1.0
                if (i >= uNumLights) break;
                vec3 L = normalize(uLightPosition[i] - vWorldPos);
                vec3 H = normalize(L + V);
                color += uAmbient * uLightAmbient[i];
                color += uDiffuse * uLightDiffuse[i] * max(dot(N,L), 0.0);
                color += uSpecular * uLightSpecular[i] * pow(max(dot(N,H), 0.0), uShininess);
            } // end for each light

            gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
        }
    `;

    // define vertex shader in essl using es6 template strings
    var vShaderCode = `
        attribute vec3 vertexPosition;
        attribute vec3 vertexNormal;
        attribute vec3 vertexFaceNormal;

        uniform mat4 uModelMatrix; // model to world
        uniform mat4 uViewMatrix; // world to view
        uniform mat4 uProjMatrix; // view to clip
        uniform mat3 uNormalMatrix; // inverse transpose of model matrix

        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec3 vFaceNormal;

        void main(void) {
            vec4 worldPos = uModelMatrix * vec4(vertexPosition, 1.0);
            vWorldPos = worldPos.xyz;
            vNormal = uNormalMatrix * vertexNormal;
            vFaceNormal = uNormalMatrix * vertexFaceNormal;
            gl_Position = uProjMatrix * uViewMatrix * worldPos;
        }
    `;

    try {
        // console.log("fragment shader: "+fShaderCode);
        var fShader = gl.createShader(gl.FRAGMENT_SHADER); // create frag shader
        gl.shaderSource(fShader,fShaderCode); // attach code to shader
        gl.compileShader(fShader); // compile the code for gpu execution

        // console.log("vertex shader: "+vShaderCode);
        var vShader = gl.createShader(gl.VERTEX_SHADER); // create vertex shader
        gl.shaderSource(vShader,vShaderCode); // attach code to shader
        gl.compileShader(vShader); // compile the code for gpu execution

        if (!gl.getShaderParameter(fShader, gl.COMPILE_STATUS)) { // bad frag shader compile
            throw "error during fragment shader compile: " + gl.getShaderInfoLog(fShader);
            gl.deleteShader(fShader);
        } else if (!gl.getShaderParameter(vShader, gl.COMPILE_STATUS)) { // bad vertex shader compile
            throw "error during vertex shader compile: " + gl.getShaderInfoLog(vShader);
            gl.deleteShader(vShader);
        } else { // no compile errors
            var shaderProgram = gl.createProgram(); // create the single shader program
            gl.attachShader(shaderProgram, fShader); // put frag shader in program
            gl.attachShader(shaderProgram, vShader); // put vertex shader in program
            gl.linkProgram(shaderProgram); // link program into gl context

            if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) { // bad program link
                throw "error during shader program linking: " + gl.getProgramInfoLog(shaderProgram);
            } else { // no shader program link errors
                gl.useProgram(shaderProgram); // activate shader program (frag and vert)

                vertexPositionAttrib = gl.getAttribLocation(shaderProgram, "vertexPosition");
                gl.enableVertexAttribArray(vertexPositionAttrib); // input to shader from array
                vertexNormalAttrib = gl.getAttribLocation(shaderProgram, "vertexNormal");
                gl.enableVertexAttribArray(vertexNormalAttrib); // input to shader from array
                vertexFaceNormalAttrib = gl.getAttribLocation(shaderProgram, "vertexFaceNormal");
                gl.enableVertexAttribArray(vertexFaceNormalAttrib); // input to shader from array

                modelMatrixULoc = gl.getUniformLocation(shaderProgram, "uModelMatrix");
                viewMatrixULoc = gl.getUniformLocation(shaderProgram, "uViewMatrix");
                projMatrixULoc = gl.getUniformLocation(shaderProgram, "uProjMatrix");
                normalMatrixULoc = gl.getUniformLocation(shaderProgram, "uNormalMatrix");
                eyePositionULoc = gl.getUniformLocation(shaderProgram, "uEyePosition");
                lightingULoc = gl.getUniformLocation(shaderProgram, "uLighting");
                numLightsULoc = gl.getUniformLocation(shaderProgram, "uNumLights");
                lightPositionULoc = gl.getUniformLocation(shaderProgram, "uLightPosition");
                lightAmbientULoc = gl.getUniformLocation(shaderProgram, "uLightAmbient");
                lightDiffuseULoc = gl.getUniformLocation(shaderProgram, "uLightDiffuse");
                lightSpecularULoc = gl.getUniformLocation(shaderProgram, "uLightSpecular");
                ambientULoc = gl.getUniformLocation(shaderProgram, "uAmbient");
                diffuseULoc = gl.getUniformLocation(shaderProgram, "uDiffuse");
                specularULoc = gl.getUniformLocation(shaderProgram, "uSpecular");
                shininessULoc = gl.getUniformLocation(shaderProgram, "uShininess");
            } // end if no shader program link errors
        } // end if no compile errors
    } // end try

    catch(e) {
        console.log(e);
    } // end catch
} // end setup shaders

// get the current view axes in world space: right (view X), up (view Y) and forward (view Z)
function getViewAxes() {
    var forward = vec3.normalize(vec3.create(),LookAt);
    var right = vec3.normalize(vec3.create(),vec3.cross(vec3.create(),forward,Up));
    var up = vec3.cross(vec3.create(),right,forward);
    return {right: right, up: up, forward: forward};
} // end get view axes

// rotate vector v in place by angle radians around axis
function rotateVector(v,axis,angle) {
    var rotation = mat4.fromRotation(mat4.create(),angle,axis);
    vec3.transformMat4(v,v,rotation);
    vec3.normalize(v,v);
} // end rotate vector

// build a model's matrix: highlight scale, then rotate, both about its center, then translate
// M = T(translation) * T(center) * R * S * T(-center)
function getModelMatrix(model,isSelected) {
    var M = mat4.create();
    var negCenter = vec3.negate(vec3.create(),model.center);
    var scale = isSelected ? HIGHLIGHT_SCALE : 1;
    mat4.translate(M,M,model.translation);
    mat4.translate(M,M,model.center);
    mat4.multiply(M,M,model.rotation);
    mat4.scale(M,M,[scale,scale,scale]);
    mat4.translate(M,M,negCenter);
    return M;
} // end get model matrix

// rotate the selected model around a view axis, so it turns the same way regardless of earlier turns
function rotateSelection(axis,angle) {
    var model = models[selectedModel];
    var turn = mat4.fromRotation(mat4.create(),angle,axis);
    mat4.multiply(model.rotation,turn,model.rotation);
} // end rotate selection

// move the selected model along a view axis
function translateSelection(axis,amount) {
    var model = models[selectedModel];
    vec3.scaleAndAdd(model.translation,model.translation,axis,amount);
} // end translate selection

// handle key presses for view changes, model selection and model transforms
function handleKeyDown(event) {
    if (event.target.tagName === "INPUT") return; // leave typing in UI fields alone
    var axes = getViewAxes();
    var haveSelection = (selectedModel >= 0);

    switch (event.key) {
        // part 4: change the view
        case "a": vec3.scaleAndAdd(Eye,Eye,axes.right,-TRANSLATE_STEP); break; // view left
        case "d": vec3.scaleAndAdd(Eye,Eye,axes.right,TRANSLATE_STEP); break; // view right
        case "w": vec3.scaleAndAdd(Eye,Eye,axes.forward,TRANSLATE_STEP); break; // view forward
        case "s": vec3.scaleAndAdd(Eye,Eye,axes.forward,-TRANSLATE_STEP); break; // view backward
        case "q": vec3.scaleAndAdd(Eye,Eye,axes.up,TRANSLATE_STEP); break; // view up
        case "e": vec3.scaleAndAdd(Eye,Eye,axes.up,-TRANSLATE_STEP); break; // view down
        case "A": rotateVector(LookAt,axes.up,ROTATE_STEP); break; // yaw left
        case "D": rotateVector(LookAt,axes.up,-ROTATE_STEP); break; // yaw right
        case "W": // pitch forward (look down); up turns with lookAt to stay perpendicular
            rotateVector(LookAt,axes.right,-ROTATE_STEP);
            rotateVector(Up,axes.right,-ROTATE_STEP);
            break;
        case "S": // pitch backward (look up)
            rotateVector(LookAt,axes.right,ROTATE_STEP);
            rotateVector(Up,axes.right,ROTATE_STEP);
            break;

        // part 5: select a model
        case "ArrowRight": // next model
            event.preventDefault();
            if (models.length > 0) selectedModel = (selectedModel + 1) % models.length;
            break;
        case "ArrowLeft": // previous model
            event.preventDefault();
            if (models.length > 0) selectedModel = (selectedModel <= 0) ? models.length - 1 : selectedModel - 1;
            break;
        case " ": // deselect
            event.preventDefault();
            selectedModel = -1;
            break;

        // part 6: transform the selected model
        case "k": if (haveSelection) translateSelection(axes.right,-TRANSLATE_STEP); break; // left
        case ";": if (haveSelection) translateSelection(axes.right,TRANSLATE_STEP); break; // right
        case "o": if (haveSelection) translateSelection(axes.forward,TRANSLATE_STEP); break; // forward
        case "l": if (haveSelection) translateSelection(axes.forward,-TRANSLATE_STEP); break; // backward
        case "i": if (haveSelection) translateSelection(axes.up,TRANSLATE_STEP); break; // up
        case "p": if (haveSelection) translateSelection(axes.up,-TRANSLATE_STEP); break; // down
        case "K": if (haveSelection) rotateSelection(axes.up,-ROTATE_STEP); break; // yaw left
        case ":": if (haveSelection) rotateSelection(axes.up,ROTATE_STEP); break; // yaw right
        case "O": if (haveSelection) rotateSelection(axes.right,-ROTATE_STEP); break; // pitch forward
        case "L": if (haveSelection) rotateSelection(axes.right,ROTATE_STEP); break; // pitch backward
        case "I": if (haveSelection) rotateSelection(axes.forward,ROTATE_STEP); break; // roll clockwise
        case "P": if (haveSelection) rotateSelection(axes.forward,-ROTATE_STEP); break; // roll counterclockwise
    } // end switch on key
} // end handle key down

// gather one property of every light into a flat array, padded to MAX_LIGHTS
function flattenLights(property) {
    var values = new Float32Array(MAX_LIGHTS*3);
    for (var whichLight=0; whichLight<lights.length; whichLight++)
        values.set(lights[whichLight][property],whichLight*3);
    return values;
} // end flatten lights

// read the canvas and window fields, then resize the canvas and reproject to match
function applyViewSettings() {
    var canvas = document.getElementById("myWebGLCanvas");
    var width = parseInt(document.getElementById("canvasWidth").value);
    var height = parseInt(document.getElementById("canvasHeight").value);
    var left = parseFloat(document.getElementById("winLeft").value);
    var right = parseFloat(document.getElementById("winRight").value);
    var bottom = parseFloat(document.getElementById("winBottom").value);
    var top = parseFloat(document.getElementById("winTop").value);

    if ((width > 0) && (height > 0)) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0,0,width,height);
    } else
        console.log("canvas width and height must be positive");

    if (isFinite(left) && isFinite(right) && isFinite(bottom) && isFinite(top) && (left !== right) && (bottom !== top)) {
        winLeft = left; winRight = right;
        winBottom = bottom; winTop = top;
    } else
        console.log("window needs four numbers, with left != right and bottom != top");
} // end apply view settings

// render the loaded model
function renderTriangles() {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); // clear frame/depth buffers
    requestAnimationFrame(renderTriangles);

    // viewing and projection transforms, shared by every model
    var center = vec3.add(vec3.create(),Eye,LookAt); // point the eye looks at
    var viewMatrix = mat4.lookAt(mat4.create(),Eye,center,Up);
    var projMatrix = mat4.frustum(mat4.create(),winLeft,winRight,winBottom,winTop,winNear,winFar);
    gl.uniformMatrix4fv(viewMatrixULoc,false,viewMatrix);
    gl.uniformMatrix4fv(projMatrixULoc,false,projMatrix);

    // eye and lights, flattened into arrays for the shader
    gl.uniform1i(lightingULoc,useLighting);
    gl.uniform3fv(eyePositionULoc,Eye);
    gl.uniform1i(numLightsULoc,lights.length);
    gl.uniform3fv(lightPositionULoc,flattenLights("position"));
    gl.uniform3fv(lightAmbientULoc,flattenLights("ambient"));
    gl.uniform3fv(lightDiffuseULoc,flattenLights("diffuse"));
    gl.uniform3fv(lightSpecularULoc,flattenLights("specular"));

    for (var whichModel=0; whichModel<models.length; whichModel++) {
        var model = models[whichModel];

        // model transform and its normal matrix
        var modelMatrix = getModelMatrix(model,whichModel === selectedModel);
        gl.uniformMatrix4fv(modelMatrixULoc,false,modelMatrix);
        gl.uniformMatrix3fv(normalMatrixULoc,false,mat3.normalFromMat4(mat3.create(),modelMatrix));

        // material
        gl.uniform3fv(ambientULoc,model.material.ambient);
        gl.uniform3fv(diffuseULoc,model.material.diffuse);
        gl.uniform3fv(specularULoc,model.material.specular);
        gl.uniform1f(shininessULoc,model.material.n);

        // vertex and normal buffers: activate and feed into vertex shader
        gl.bindBuffer(gl.ARRAY_BUFFER,model.vertexBuffer);
        gl.vertexAttribPointer(vertexPositionAttrib,3,gl.FLOAT,false,0,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,useVertexNormals ? model.vertexNormalBuffer : model.normalBuffer);
        gl.vertexAttribPointer(vertexNormalAttrib,3,gl.FLOAT,false,0,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,model.normalBuffer);
        gl.vertexAttribPointer(vertexFaceNormalAttrib,3,gl.FLOAT,false,0,0);

        gl.drawArrays(gl.TRIANGLES,0,model.vertexCount); // render
    } // end for each model
} // end render triangles


/* MAIN -- HERE is where execution begins after window load */

function main() {

  setupWebGL(); // set up the webGL environment
  loadTriangles(); // load in the triangles from tri file
  loadLights(); // load in the lights from lights file
  setupShaders(); // setup the webGL shaders

  var lightingBox = document.getElementById("useLighting");
  if (lightingBox) {
      useLighting = lightingBox.checked;
      lightingBox.onchange = function() {
          useLighting = lightingBox.checked;
          lightingBox.blur(); // so space deselects instead of toggling the box
      };
  }
  var vertexNormalsBox = document.getElementById("useVertexNormals");
  if (vertexNormalsBox) {
      useVertexNormals = vertexNormalsBox.checked;
      vertexNormalsBox.onchange = function() {
          useVertexNormals = vertexNormalsBox.checked;
          vertexNormalsBox.blur(); // so space deselects instead of toggling the box
      };
  }
  document.getElementById("applyView").onclick = applyViewSettings;
  document.addEventListener("keydown",handleKeyDown);

  renderTriangles(); // draw the triangles using webGL

} // end main
