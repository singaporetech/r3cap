/**
 * @file MeasurementPlateObject.ts
 * @description Manages the visual representation of measurements in the 3D scene.
 * Combines measurement data (startPoint, endPoint, distance) with visual components
 * (dashed line, distance text, interactive colliders). Provides methods for creating,
 * updating, and managing measurement visuals.
 * 
 * @author nirmalsnair, leonfoo, wesleyqua
 * @date 09/12/2024
 */

import { Mesh, MeshBuilder, Scene, Vector3, LinesMesh, StandardMaterial, Color3, ActionManager, ExecuteCodeAction } from "@babylonjs/core";
import { Rectangle, TextBlock, Image, AdvancedDynamicTexture } from "@babylonjs/gui";
import { RenderConfig, MeasurementConfig } from "../config";
import { ObjectPickingManager } from "../objectPickingSelection/ObjectPickingManager";
import { AnnotationComponent } from "../roomController/objects/components/AnnotationComponent";

export class MeasurementPlateObject //extends SpatialUIObject
{
    // Measurement data
    measurement_instance_id: number;
    startPoint: Vector3;
    endPoint: Vector3;
    distanceMeasured: number;

    // Visual components
    line: LinesMesh;
    textMesh: Mesh

    // Interactive colliders for editing
    startPointCollider: Mesh | null = null;
    endPointCollider: Mesh | null = null;
    
    scene: Scene;
    
    // Reference to parent controller for hover callbacks
    onHoverCallback: ((measurementId: number, isHovering: boolean) => void) | null = null;



/**
 * Constructor for MeasurementPlateObject
 * @param measurement_instance_id - Unique identifier for this measurement
 * @param startPoint - Starting point of the measurement
 * @param endPoint - Ending point of the measurement
 * @param distanceMeasured - Calculated distance between points
 * @param scene - Babylon.js scene
 */
    constructor(
        measurement_instance_id: number,
        startPoint: Vector3,
        endPoint: Vector3,
        distanceMeasured: number,
        scene: Scene
    ) {
        this.measurement_instance_id = measurement_instance_id;
        this.startPoint = startPoint;
        this.endPoint = endPoint;
        this.distanceMeasured = distanceMeasured;
        this.scene = scene;
    }

    /**
     * Initializes the plate visuals (line, text, and colliders)
     */
    async InitPlate()
    {
        this.CreatePlate();
        this.CreateStartSphere();
        this.CreateEndSphere();
    }

    /**
     * Creates the dashed line and distance text for the measurement
     */
    async CreatePlate()
    {
        this.line = MeshBuilder.CreateDashedLines("measureLine", {
            points: [this.startPoint, this.endPoint],
            dashSize: MeasurementConfig.line_dash_size,
            gapSize: MeasurementConfig.line_gap_size,
            dashNb: Math.max(5, Math.floor(this.distanceMeasured * MeasurementConfig.line_dash_multiplier))
        }, this.scene);
        this.line.renderingGroupId = RenderConfig.worldSpace;
        this.line.isPickable = false;

        this.textMesh = this.Create3DText(
            `${this.distanceMeasured.toFixed(2)}m`,
            this.startPoint.add(this.endPoint).scale(0.5));
    }

    /**
     * Updates the measurement with new points and recreates the visual
     * @param startPoint - New starting point
     * @param endPoint - New ending point
     */
    public UpdateMeasurement(startPoint: Vector3, endPoint: Vector3): void {
        this.startPoint = startPoint;
        this.endPoint = endPoint;
        this.distanceMeasured = Vector3.Distance(startPoint, endPoint);

        // Dispose old visuals
        if (this.line) {
            this.line.dispose();
        }
        if (this.textMesh) {
            this.textMesh.dispose();
        }
        if (this.startPointCollider) {
            this.startPointCollider.dispose();
        }
        if (this.endPointCollider) {
            this.endPointCollider.dispose();
        }

        // Recreate visuals
        this.CreatePlate();
        this.CreateStartSphere();
        this.CreateEndSphere();
    }

    /**
     * Creates a 3D text mesh at the specified position with a dark outline for better visibility.
     * @param text - The text to display.
     * @param position - The position of the text in 3D space.
     * @returns A mesh representing the 3D text.
     */
    public Create3DText(text: string, position: Vector3): Mesh {
        const plane = MeshBuilder.CreatePlane("textPlane", { width: 1, height: 0.5 }, this.scene);

        // Offset the position vertically higher and slightly forward
        const offsetY = MeasurementConfig.text_offset_y;
        const offsetZ = MeasurementConfig.text_offset_z;
        plane.position = position.add(new Vector3(0, offsetY, offsetZ));
        plane.renderingGroupId = RenderConfig.highlights
        const dynamicTexture = AdvancedDynamicTexture.CreateForMesh(plane, 1024, 512);

        // Create a container for the text and its shadow
        const container = new Rectangle();
        container.width = 1;
        container.height = 1;
        container.thickness = 0;
        dynamicTexture.addControl(container);

        // Create the shadow text
        const shadowText = new TextBlock();
        shadowText.text = text;
        shadowText.color = MeasurementConfig.text_fill_color;
        shadowText.fontSize = MeasurementConfig.text_font_size;
        shadowText.fontWeight = "bold";
        shadowText.left = MeasurementConfig.text_shadow_offset;  // Offset for shadow effect
        shadowText.top = MeasurementConfig.text_shadow_offset;   // Offset for shadow effect
        container.addControl(shadowText);

        // Create the main text
        const mainText = new TextBlock();
        mainText.text = text;
        mainText.color = MeasurementConfig.text_background_color;
        mainText.fontSize = MeasurementConfig.text_font_size;
        mainText.fontWeight = "bold";
        container.addControl(mainText);

        // Make the text always face the camera
        plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
        ObjectPickingManager.instance.hlLayer.addExcludedMesh(plane);

        // Make the text not clickable
        plane.isPickable = false;

        return plane;
    }

    /**
     * Creates a visible bounding sphere at the given position.
     * This helps users visualize the collision area of the measurement point.
     */
    public CreateStartSphere() 
    {
        this.startPointCollider = MeshBuilder.CreateSphere("startAxisCollider", { diameter: MeasurementConfig.sphere_diameter}, this.scene);
        this.startPointCollider.position = this.startPoint;
        this.startPointCollider.isPickable = true;
        this.startPointCollider.renderingGroupId = RenderConfig.worldSpace;
        
        const sphereMaterial = new StandardMaterial(`startSphereMaterial_${this.measurement_instance_id}`, this.scene);
        sphereMaterial.emissiveColor = Color3.FromHexString(MeasurementConfig.colors_point_default);
        sphereMaterial.disableLighting = true;
        this.startPointCollider.material = sphereMaterial;
        
        this.startPointCollider.metadata = 
        {
            measurementPlate: this,
            pointType: "start",
            measurementId: this.measurement_instance_id
        };

        this.SetupColliderActionManager(this.startPointCollider);
    }
    
    public CreateEndSphere() 
    {
        this.endPointCollider = MeshBuilder.CreateSphere("endAxisCollider", { diameter: MeasurementConfig.sphere_diameter}, this.scene);
        this.endPointCollider.position = this.endPoint;
        this.endPointCollider.isPickable = true;
        this.endPointCollider.renderingGroupId = RenderConfig.worldSpace;
        
        // Create wireframe material for the sphere
        const sphereMaterial = new StandardMaterial(`endSphereMaterial_${this.measurement_instance_id}`, this.scene);
        sphereMaterial.emissiveColor = Color3.FromHexString(MeasurementConfig.colors_point_default);
        sphereMaterial.disableLighting = true;
        this.endPointCollider.material = sphereMaterial;
        
        this.endPointCollider.metadata = 
        {
            measurementPlate: this,
            pointType: "end",
            measurementId: this.measurement_instance_id
        };

        this.SetupColliderActionManager(this.endPointCollider);
    }

    /**
     * Sets the color of the measurement (line and spheres)
     * @param color - The color to set
     */
    public SetColor(color: Color3): void 
    {
        if (this.line) 
        {
            this.line.color = color;
        }
        if (this.startPointCollider && this.startPointCollider.material) 
        {
            (this.startPointCollider.material as StandardMaterial).emissiveColor = color;
        }
        if (this.endPointCollider && this.endPointCollider.material) 
        {
            (this.endPointCollider.material as StandardMaterial).emissiveColor = color;
        }
    }

    /**
     * Sets the color of a specific point collider
     */
    public SetPointColor(pointType: "start" | "end", color: Color3): void
    {
        const collider = pointType === "start" ? this.startPointCollider : this.endPointCollider;
        if (collider && collider.material) {
            (collider.material as StandardMaterial).emissiveColor = color;
        }
    }

    /**
     * Sets the rendering group for the measurement line and colliders
     */
    public SetRenderingGroup(renderingGroupId: number): void
    {
        if (this.line) {
            this.line.renderingGroupId = renderingGroupId;
        }
        if (this.startPointCollider) {
            this.startPointCollider.renderingGroupId = renderingGroupId;
        }
        if (this.endPointCollider) {
            this.endPointCollider.renderingGroupId = renderingGroupId;
        }
    }

    /**
     * Sets up ActionManager for collider hover detection
     */
    private SetupColliderActionManager(collider: Mesh): void
    {
        const _this = this;
        
        collider.actionManager = new ActionManager(this.scene);

        // Hover over - move to highlights layer
        collider.actionManager.registerAction(
            new ExecuteCodeAction(
                {
                    trigger: ActionManager.OnPointerOverTrigger,
                },
                function () {
                    _this.SetRenderingGroup(RenderConfig.highlights);
                    if (_this.onHoverCallback) {
                        _this.onHoverCallback(_this.measurement_instance_id, true);
                    }
                },
            ),
        );

        // Hover exit - move back to worldSpace
        collider.actionManager.registerAction(
            new ExecuteCodeAction(
                {
                    trigger: ActionManager.OnPointerOutTrigger,
                },
                function () {
                    _this.SetRenderingGroup(RenderConfig.worldSpace);
                    if (_this.onHoverCallback) {
                        _this.onHoverCallback(_this.measurement_instance_id, false);
                    }
                },
            ),
        );
    }

    ClearGUI()
    {
        if(this.line)
        {
            this.line.dispose();
        }
        this.line = null;

        if(this.textMesh)
        {
            this.textMesh.dispose();
        }
        this.textMesh = null;

        if (this.startPointCollider) 
        {
            this.startPointCollider.dispose();
            this.startPointCollider = null;
        }
        if (this.endPointCollider) 
        {
            this.endPointCollider.dispose();
            this.endPointCollider = null;
        }

    }    
}
