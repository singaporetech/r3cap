/**
 * @file MeasureMenuController.ts
 * @description This file contains the MeasureMenuController class, which manages the UI and functionality
 * for measuring distances within a 3D scene using Babylon.js. It allows users to create measurement lines
 * and displays the distance between two points in the scene.
 * 
 * @author nirmalsnair, leonfoo, wesleyqua
 * @date 09/12/2024
 */

import { AdvancedDynamicTexture, Rectangle, TextBlock } from "@babylonjs/gui";
import { Scene, Vector3, MeshBuilder, LinesMesh, Mesh, Color3, StandardMaterial } from "@babylonjs/core";
import { GuiMenu, GuiMenuToggle, GuiMenuManager } from "../GuiMenu";
import { SocketHandler } from "../../networking/WebSocketManager";
import { MeasurementData } from "../../utilities/data/MeasurementData";
import { RenderConfig, MeasurementConfig } from "../../config";
import { MeasurementPlateObject } from "../MeasurementPlateObject";
import { ButtonMetadata } from "../../utilities/data/ObjectsData";
import { UIUtility } from "../../utilities/UIUtility";
import { PointerInfo, PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { IPointerEvent } from "@babylonjs/core/Events/deviceInputEvents";
import { ActionStates } from "../../utilities/enums/enums";

/**
 * Manages the measurement functionality in the 3D scene.
 * Implements a singleton pattern for global access.
 */
export class MeasureMenuController 
{

    public static instance: MeasureMenuController | null = null;
    
    scene!: Scene;
    toggleButton!: Rectangle;
    
    // Action buttons for add/delete 
    measurementCreateButton!: Rectangle;
    measurementDeleteButton!: Rectangle;
    selectActionsContainer!: Rectangle;
    selectActionsGUIMenu!: GuiMenu;
    selectActionsMenuGroup!: GuiMenuToggle;
    
    // Stores all active measurement plate objects (contains both data and visuals)
    measurementsList: Map<number, MeasurementPlateObject>;
    
    // Current action state (None, Add, Remove)
    private currentActionState: ActionStates = ActionStates.None;
    
    startPoint: Vector3 | null = null;
    currentLine: LinesMesh | null = null;
    
    private isDraggingMeasurement: boolean = false;
    private lastValidPickedPoint: Vector3 | null = null;
    
    // Store observable handlers for proper cleanup
    private pointerObserver: any = null;
    private beforeRenderObserver: any = null;
    dynamicTextMesh: Mesh | null = null;

    // Edit mode properties 
    private isMovingPoint: boolean = false;
    private selectedMeasurementId: number = -1;
    private selectedPointType: "start" | "end" | null = null;
    private selectedPlateObject: MeasurementPlateObject | null = null;
    
    // Preview elements for click-and-move 
    private fixedPoint: Vector3 | null = null;
    private movePreviewLine: LinesMesh | null = null;
    private movePreviewText: Mesh | null = null;

    private hoveredMeasurementId: number = -1;
    private hoveredPointType: "start" | "end" | null = null;

    public plateObjects: Map<number, MeasurementPlateObject> = new Map<number, MeasurementPlateObject>;

    constructor() 
    {
        MeasureMenuController.instance = this;
        this.measurementsList = new Map<number, MeasurementPlateObject>(); // Initialize the measurementsList
    }

    /**
     * Initializes the Measure Menu Controller with the given dynamic texture and scene.
     * @param advDynamicTexture - The advanced dynamic texture for GUI controls.
     * @param scene - The Babylon.js scene.
     */
    public Init(advDynamicTexture: AdvancedDynamicTexture, scene: Scene): void 
    {
        this.scene = scene;

        this.toggleButton = advDynamicTexture.getControlByName("Navbar_MenuToggle_Measure") as Rectangle;
        this.toggleButton.metadata = new ButtonMetadata(-1, false, false);

        // Ensure the text block does not block pointer events
        const buttonText = this.toggleButton.getChildByName("Textblock") as TextBlock;
        if (buttonText)
        {
            buttonText.isPointerBlocker = false; // Allow pointer events to pass through
        }

        // Add hover effects to the toggle button
        this.toggleButton.onPointerEnterObservable.add(UIUtility.SetHoverOn)
        this.toggleButton.onPointerOutObservable.add(UIUtility.SetHoverOff)

        const measurementSelectToolActionContainer = advDynamicTexture.getControlByName("Measurement_SelectTool_Container") as Rectangle;
        if (measurementSelectToolActionContainer) 
            {
            this.selectActionsContainer = measurementSelectToolActionContainer;
            this.selectActionsContainer.isVisible = false;
            
            this.selectActionsGUIMenu = new GuiMenu(this.selectActionsContainer);
            this.selectActionsGUIMenu.OnEnableCallback = () => 
            {
                this.selectActionsGUIMenu.container.isVisible = true;
                UIUtility.SetSelectedOn(this.toggleButton as Rectangle);
            };
            this.selectActionsGUIMenu.OnDisableCallback = () => 
            {
                this.selectActionsGUIMenu.container.isVisible = false;
                UIUtility.SetSelectedOff(this.toggleButton as Rectangle);
            };
        }

        // Setup GUI menu and toggle group
        const guiMenu = new GuiMenu(this.toggleButton);
        guiMenu.OnEnableCallback = () => 
            {
            this.EnableMeasuring();
            this.toggleButton.metadata.isSelected = true;
            if (this.selectActionsGUIMenu) 
            {
                this.selectActionsGUIMenu.container.isVisible = true;
            }
        };

        guiMenu.OnDisableCallback = () => 
            {
            this.DisableMeasuring();
            this.toggleButton.metadata.isSelected = false;
            if (this.selectActionsGUIMenu) 
            {
                this.selectActionsGUIMenu.container.isVisible = false;
            }
        };

        const menuMeasureGroup = new GuiMenuToggle(this.toggleButton, guiMenu);
        if (this.selectActionsGUIMenu) 
        {
            this.selectActionsMenuGroup = new GuiMenuToggle(this.toggleButton, this.selectActionsGUIMenu);
        }
        
        const toggleGroup = GuiMenuManager.instance.FindOrCreateToggleGroup("Navbar");
        toggleGroup.AddToggle(menuMeasureGroup);
        
        // Handle button selection
        this.toggleButton.onPointerDownObservable.add(() => 
            {
            toggleGroup.ActivateToggle(menuMeasureGroup);
            this.SetActionState(ActionStates.None);
        });
        
        this.SetupCreateAndDeleteActions(advDynamicTexture);
    }
    
    /**
     * Sets up the create and delete action buttons similar to AnnotationMenuController
     */
    private SetupCreateAndDeleteActions(advDynamicTexture: AdvancedDynamicTexture): void 
    {
        this.measurementCreateButton = advDynamicTexture.getControlByName("Measurement_Create") as Rectangle;
        this.measurementDeleteButton = advDynamicTexture.getControlByName("Measurement_Delete") as Rectangle;
        
        if (!this.measurementCreateButton || !this.measurementDeleteButton) 
        {
            console.warn("Measurement Create/Delete buttons not found in GUI. Button functionality will not be available.");
            return;
        }

        if (this.measurementCreateButton.children[0]) 
        {
            this.measurementCreateButton.children[0].isEnabled = false;
        }
        if (this.measurementDeleteButton.children[0]) 
        {
            this.measurementDeleteButton.children[0].isEnabled = false;
        }

        this.measurementCreateButton.metadata = new ButtonMetadata();
        this.measurementDeleteButton.metadata = new ButtonMetadata();

        this.measurementCreateButton.onPointerEnterObservable.add(UIUtility.SetHoverOn);
        this.measurementCreateButton.onPointerOutObservable.add(UIUtility.SetHoverOff);
        this.measurementDeleteButton.onPointerEnterObservable.add(UIUtility.SetHoverOn);
        this.measurementDeleteButton.onPointerOutObservable.add(UIUtility.SetHoverOff);

        this.measurementCreateButton.onPointerDownObservable.add((eventData, eventState) => 
        {
            if (eventData) {} // Suppress warning
            if (!eventState.target) return;
            if (eventState.target !== this.measurementCreateButton) return;
            const newState = (this.currentActionState === ActionStates.Add) ? ActionStates.None : ActionStates.Add;
            this.SetActionState(newState);
        });

        this.measurementDeleteButton.onPointerDownObservable.add((eventData, eventState) => 
        {
            if (eventData) {} // Suppress warning
            if (!eventState.target) return;
            if (eventState.target !== this.measurementDeleteButton) return;
            const newState = (this.currentActionState === ActionStates.Remove) ? ActionStates.None : ActionStates.Remove;
            this.SetActionState(newState);
        });
    }
    
    /**
     * Sets the current action state and updates button visual states
     * @param state - The new action state (None, Add, Remove)
     */
    private SetActionState(state: ActionStates): void 
    {
        this.currentActionState = state;
        this.UpdateActionButtonStates(state);
        
        if (this.currentActionState !== ActionStates.Remove && this.hoveredMeasurementId !== -1) 
        {
            this.SetMeasurementColor(this.hoveredMeasurementId, MeasurementConfig.colors_default);
            this.hoveredMeasurementId = -1;
        }
        
        // Log state changes
        if (state === ActionStates.Remove) 
        {
            console.log("Delete mode ENABLED - Hover over measurements to highlight them red, then click to delete");
        } 
        else if (state === ActionStates.Add)
        {
            console.log("Add mode ENABLED - Click to create measurements");
        }
        else 
        {
            console.log("Action mode DISABLED");
        }
    }
    
    /**
     * Updates the visual state of action buttons based on current action state
     * @param action - The current action state
     */
    private UpdateActionButtonStates(action: ActionStates): void 
    {
        if (!this.measurementCreateButton || !this.measurementDeleteButton) {
            return;
        }
        
        switch(action) 
        {
            case ActionStates.None:
                UIUtility.SetSelectedOff(this.measurementCreateButton);
                UIUtility.SetSelectedOff(this.measurementDeleteButton);
                break;
            case ActionStates.Add:
                UIUtility.SetSelectedOn(this.measurementCreateButton);
                UIUtility.SetSelectedOff(this.measurementDeleteButton);
                break;
            case ActionStates.Remove:
                UIUtility.SetSelectedOff(this.measurementCreateButton);
                UIUtility.SetSelectedOn(this.measurementDeleteButton);
                break;
            default:
                console.warn("Invalid action state value: " + action);
                break;
        }
        
        console.log("Measurement action state changed to: " + action);
    }

    /**
     * Toggles delete mode on/off (for keyboard shortcut)
     */
    private ToggleDeleteMode(): void 
    {
        const newState = (this.currentActionState === ActionStates.Remove) ? ActionStates.None : ActionStates.Remove;
        this.SetActionState(newState);
    }

    /**
     * Deletes a measurement by ID
     */
    private DeleteMeasurement(measurementId: number): void 
    {
        if (measurementId === -1) 
        {
            console.warn("No measurement to delete");
            return;
        }

        this.SendDeleteMeasurementRequestToServer(measurementId);
        console.log(`Sent request for deleting measurement ${measurementId}`);
    }

    /**
     * Sets a measurement line and spheres color
     * @param measurementId - The ID of the measurement to color
     * @param colorHex - The hex color string to apply
     */
    private SetMeasurementColor(measurementId: number, colorHex: string): void 
    {
        const plateObject = this.plateObjects.get(measurementId);
        if (plateObject) 
        {
            if (plateObject.line) 
            {
                plateObject.line.color = Color3.FromHexString(colorHex);
            }
            if (plateObject.startPointCollider && plateObject.startPointCollider.material) 
            {
                (plateObject.startPointCollider.material as StandardMaterial).emissiveColor = Color3.FromHexString(colorHex);
            }
            if (plateObject.endPointCollider && plateObject.endPointCollider.material) 
            {
                (plateObject.endPointCollider.material as StandardMaterial).emissiveColor = Color3.FromHexString(colorHex);
            }
        }
    }

    /**
     * Sends measurement deletion request to server
     */
    private SendDeleteMeasurementRequestToServer(measurementId: number): void 
    {
        try {
            SocketHandler.SendData(
                SocketHandler.CodeToServer.EditServer_ClientRequest_DeleteMeasurementObject, 
                { measurement_instance_id: measurementId }
            );

            console.log("Measurement deletion sent to server:", measurementId);
        } catch (error) {
            console.error("Error sending measurement deletion to server:", error);
        }
    }

    /**
     * Handles receiving measurement deletion from server
     */
    public ReceiveDeleteMeasurementRequestFromServer(deleteData: { measurement_instance_id: number }): void 
    {
        const measurementId = deleteData.measurement_instance_id;
        const plateObject = this.plateObjects.get(measurementId);

        if (!plateObject) 
        {
            console.warn(`Received delete request for unknown measurement ${measurementId}`);
            return;
        }

        plateObject.ClearGUI();

        this.plateObjects.delete(measurementId);
        this.measurementsList.delete(measurementId);

        // Reset selection state if we deleted the selected measurement
        if (this.selectedMeasurementId === measurementId) 
        {
            this.ClearMovePreview();
            this.isMovingPoint = false;
            this.selectedPlateObject = null;
            this.selectedPointType = null;
            this.selectedMeasurementId = -1;
            this.fixedPoint = null;
        }


        console.log(`Deleted measurement ${measurementId} from server request`);
    }


    /**
     * Enables the measuring functionality, allowing users to create measurement lines.
     * Sets up event listeners for pointer interactions and keyboard input.
     */
    private EnableMeasuring(): void 
    {
        if (!this.scene) return;

        const onKeyDown = (event: KeyboardEvent) =>
             {
            if (event.key === "Escape") 
            {
                if (this.currentActionState !== ActionStates.None) 
                {
                    this.SetActionState(ActionStates.None);
                } else 
                {
                    this.DisableMeasuring();
                }
            }
            if (event.key === "x" || event.key === "X") 
            {
                if (this.isMovingPoint && this.selectedMeasurementId !== -1) 
                {
                    // Cancel the move operation first
                    this.ClearMovePreview();
                    this.isMovingPoint = false;
                    this.selectedPlateObject = null;
                    this.selectedPointType = null;
                    this.fixedPoint = null;
                    
                    // Delete the measurement
                    this.DeleteMeasurement(this.selectedMeasurementId);
                    this.selectedMeasurementId = -1;
                    
                    return;
                }
                
                this.ToggleDeleteMode();
            }
        };
        
        window.addEventListener("keydown", onKeyDown);

        this.pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => 
            {
            if (pointerInfo.type === PointerEventTypes.POINTERDOWN) 
                {
                this.HandlePointerDown(pointerInfo);
            }
            else if (pointerInfo.type === PointerEventTypes.POINTERUP)
                {
                this.HandlePointerUp(pointerInfo);
            }
        });
        

        this.beforeRenderObserver = this.scene.onBeforeRenderObservable.add(() => this.HandlePointerMove());

        this.scene.onDisposeObservable.addOnce(() => 
            {
            window.removeEventListener("keydown", onKeyDown);
        });
    }


    /**
     * Handles pointer down events for measurements.
     * In delete mode, clicking on a measurement deletes it.
     */
    private HandlePointerDown(pointerInfo: PointerInfo): void 
    {
        if (!this.scene) return;

        const event = pointerInfo.event as IPointerEvent;
        // Check if it's a mouse event with non-left button
        if (event.pointerType === "mouse" && event.button !== 0) return;
        
        const pickResult = this.scene.pick(this.scene.pointerX, this.scene.pointerY);

        // If it did not pick anything
        if (!pickResult.hit || !pickResult.pickedPoint) return;

        // If it is currently delete mode and something is being hovered on
        if (this.currentActionState === ActionStates.Remove && this.hoveredMeasurementId !== -1) 
        {
            this.DeleteMeasurement(this.hoveredMeasurementId);
            return;
        }

        // Don't allow any other interactions in delete mode
        if (this.currentActionState === ActionStates.Remove) 
        {
            return;
        }

        // If picked and valid
        if (pickResult.pickedMesh && pickResult.pickedMesh.metadata) 
        {
            const metadata = pickResult.pickedMesh.metadata;
            if (metadata.measurementPlate && metadata.pointType && metadata.measurementId) 
            {
                this.StartMovingPoint(metadata.measurementPlate, metadata.pointType, metadata.measurementId);
                return;
            }
        }

        // If Add mode and nothing is dragged 
        if (this.currentActionState === ActionStates.Add && !this.isDraggingMeasurement && !this.isMovingPoint) 
        {
            this.StartNewMeasurement(pickResult.pickedPoint);
            this.isDraggingMeasurement = true;
        }
    }

    /**
     * Handles pointer up events for measurements.
     * Completes a drag operation for creating or editing measurements.
     */
    private HandlePointerUp(pointerInfo: PointerInfo): void 
    {
        if (!this.scene) return;

        const event = pointerInfo.event as IPointerEvent;
        // Check if it's a mouse event with non-left button
        if (event.pointerType === "mouse" && event.button !== 0) return;

        const pickResult = this.scene.pick(this.scene.pointerX, this.scene.pointerY);

        if (this.isMovingPoint && this.selectedPlateObject && this.selectedPointType) 
        {
            const pointToUse = (pickResult.hit && pickResult.pickedPoint) ? pickResult.pickedPoint : this.lastValidPickedPoint;
            if (pointToUse) 
            {
                this.CompleteMove(pointToUse);
            } else 
            {
                this.CancelMoveOperation();
            }
            return;
        }

        // Complete measurement creation if we were dragging
        if (this.isDraggingMeasurement && this.startPoint) 
        {
            // Use clamped point if out of bounds
            const pointToUse = (pickResult.hit && pickResult.pickedPoint) ? pickResult.pickedPoint : this.lastValidPickedPoint;
            if (pointToUse) 
            {
                this.CompleteMeasurement(pointToUse);
            } else 
            {
                this.CancelMeasurementCreation();
            }
            this.isDraggingMeasurement = false;
        }
    }


    /**
     * Handles pointer move events for updating the measurement preview or move preview.
     * In delete mode, highlights measurements red when hovering over them.
     */
    private HandlePointerMove(): void 
    {
        if (!this.scene) return;

        const pickResult = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
        
        if (this.currentActionState === ActionStates.Remove) 
        {
            let newHoveredId = -1;
            
            // Check if we're hovering over a measurement collider
            if (pickResult.hit && pickResult.pickedMesh && pickResult.pickedMesh.metadata) 
            {
                const metadata = pickResult.pickedMesh.metadata;
                if (metadata.measurementId !== undefined) 
                {
                    newHoveredId = metadata.measurementId;
                }
            }
            
            // If hovered measurement changed, update colors
            if (newHoveredId !== this.hoveredMeasurementId) 
            {
                // Reset previous hovered measurement color
                if (this.hoveredMeasurementId !== -1) 
                {
                    this.SetMeasurementColor(this.hoveredMeasurementId, MeasurementConfig.colors_default);
                }
                
                // Set new hovered measurement color to red
                if (newHoveredId !== -1) 
                {
                    this.SetMeasurementColor(newHoveredId, MeasurementConfig.colors_delete);
                }
                
                this.hoveredMeasurementId = newHoveredId;
            }
            
            return; // Don't process other pointer move logic in delete mode
        }

        if (!this.isMovingPoint && !this.isDraggingMeasurement) 
        {
            let newHoveredId = -1;
            let newHoveredPointType: "start" | "end" | null = null;
            
            if (pickResult.hit && pickResult.pickedMesh && pickResult.pickedMesh.metadata) 
            {
                const metadata = pickResult.pickedMesh.metadata;
                if (metadata.measurementPlate && metadata.pointType && metadata.measurementId) 
                {
                    newHoveredId = metadata.measurementId;
                    newHoveredPointType = metadata.pointType;
                }
            }
            
            if (newHoveredId !== this.hoveredMeasurementId || newHoveredPointType !== this.hoveredPointType) 
            {
                // Reset previous hovered measurement
                if (this.hoveredMeasurementId !== -1) 
                {
                    const prevPlateObject = this.plateObjects.get(this.hoveredMeasurementId);
                    if (prevPlateObject) 
                    {
                        if (prevPlateObject.line) 
                        {
                            prevPlateObject.line.color = Color3.FromHexString(MeasurementConfig.colors_default);
                        }
                        if (this.hoveredPointType) 
                        {
                            prevPlateObject.SetPointColor(this.hoveredPointType, Color3.FromHexString(MeasurementConfig.colors_point_default));
                        }
                        prevPlateObject.SetRenderingGroup(RenderConfig.worldSpace);
                    }
                }
                
                if (newHoveredId !== -1 && newHoveredPointType) 
                {
                    const plateObject = this.plateObjects.get(newHoveredId);
                    if (plateObject) 
                    {
                        if (plateObject.line) 
                        {
                            plateObject.line.color = Color3.FromHexString(MeasurementConfig.colors_hover);
                        }
                        plateObject.SetPointColor(newHoveredPointType, Color3.FromHexString(MeasurementConfig.colors_hover));
                        plateObject.SetRenderingGroup(RenderConfig.highlights);
                    }
                }
                
                this.hoveredMeasurementId = newHoveredId;
                this.hoveredPointType = newHoveredPointType;
            }
        }

        // Track the last valid picked point for clamping
        if (pickResult.hit && pickResult.pickedPoint) 
        {
            this.lastValidPickedPoint = pickResult.pickedPoint.clone();
        }

        // Use clamped point if out of bounds
        const pointToUse = (pickResult.hit && pickResult.pickedPoint) ? pickResult.pickedPoint : this.lastValidPickedPoint;
        if (!pointToUse) return;

        if (this.isMovingPoint && this.selectedPlateObject && this.selectedPointType) 
        {
            this.UpdateMovePreview(pointToUse);
        } else if (this.isDraggingMeasurement && this.startPoint && this.currentLine) 
        {
            // Update measurement preview while dragging
            this.UpdateMeasuringDisplay(pointToUse);
        }
    }

    /**
     * Starts moving a measurement point (first click on the point)
     * Hides the original plate and stores the fixed point
     */
    private StartMovingPoint(plateObject: MeasurementPlateObject, pointType: "start" | "end", measurementId: number): void {
        this.isMovingPoint = true;
        this.selectedPlateObject = plateObject;
        this.selectedPointType = pointType;
        this.selectedMeasurementId = measurementId;

        // Store the fixed point (the one we're NOT moving)
        const currentStart = plateObject.startPoint;
        const currentEnd = plateObject.endPoint;
        this.fixedPoint = (pointType === "start") ? currentEnd : currentStart;

        plateObject.SetColor(Color3.FromHexString(MeasurementConfig.colors_hover));

        // Hide the original plate by clearing its GUI
        plateObject.ClearGUI();

        console.log(`Started moving ${pointType} point of measurement ${this.selectedMeasurementId}`);
    }

    /**
     * Updates the preview while moving a measurement point
     */
    private UpdateMovePreview(newPosition: Vector3): void 
    {
        if (!this.fixedPoint) return;

        // Clear previous preview elements
        this.ClearMovePreview();

        const distance = Vector3.Distance(this.fixedPoint, newPosition);
        const midPoint = this.fixedPoint.add(newPosition).scale(0.5);

        // Create preview line from fixed point to cursor (green color)
        this.movePreviewLine = MeshBuilder.CreateLines("movePreviewLine", 
        {
            points: [this.fixedPoint, newPosition],
            updatable: true
        }, this.scene);
        this.movePreviewLine.color = Color3.FromHexString(MeasurementConfig.colors_hover);
        this.movePreviewLine.isPickable = false;
        this.movePreviewLine.renderingGroupId = RenderConfig.worldSpace;

        // Create text showing the distance
        this.movePreviewText = this.CreateMeasurementText(`${distance.toFixed(2)}m`, midPoint);
    }

    /**
     * Clears the move preview elements
     */
    private ClearMovePreview(): void 
    {
        if (this.movePreviewLine) 
        {
            this.movePreviewLine.dispose();
            this.movePreviewLine = null;
        }
        if (this.movePreviewText) 
        {
            this.movePreviewText.dispose();
            this.movePreviewText = null;
        }
    }

    /**
     * Completes the move operation 
     */
    private CompleteMove(finalPosition: Vector3): void 
    {
        if (!this.selectedPlateObject || !this.selectedPointType || !this.fixedPoint) return;

        let newStartPoint: Vector3;
        let newEndPoint: Vector3;

        if (this.selectedPointType === "start") 
        {
            newStartPoint = finalPosition;
            newEndPoint = this.fixedPoint;
        } else 
        {
            newStartPoint = this.fixedPoint;
            newEndPoint = finalPosition;
        }

        this.UpdateExistingMeasurement(this.selectedMeasurementId, newStartPoint, newEndPoint);

        this.ClearMovePreview();

        this.isMovingPoint = false;
        this.selectedPlateObject = null;
        this.selectedPointType = null;
        this.selectedMeasurementId = -1;
        this.fixedPoint = null;
    }

    /**
     * Cancels the move operation and restores the measurement
     */
    private CancelMoveOperation(): void 
    {
        if (!this.selectedPlateObject) return;

        this.selectedPlateObject.InitPlate();

        this.ClearMovePreview();

        this.isMovingPoint = false;
        this.selectedPlateObject = null;
        this.selectedPointType = null;
        this.selectedMeasurementId = -1;
        this.fixedPoint = null;

    }

    /**
     * Cancels the measurement creation
     */
    private CancelMeasurementCreation(): void 
    {
        // Dispose of the preview line
        if (this.currentLine) 
        {
            this.currentLine.dispose();
            this.currentLine = null;
        }

        // Dispose of the dynamic text
        if (this.dynamicTextMesh) 
        {
            this.dynamicTextMesh.dispose();
            this.dynamicTextMesh = null;
        }

        this.startPoint = null;
    }

    /**
     * Starts a new measurement from the given point.
     * @param pickedPoint - The starting point of the measurement.
     */
    public StartNewMeasurement(pickedPoint: Vector3): void 
    {
        this.startPoint = pickedPoint.clone();
        this.currentLine = MeshBuilder.CreateLines("measureLine", 
        {
            points: [this.startPoint, this.startPoint.clone()],
            updatable: true
        }, this.scene);
        this.currentLine.renderingGroupId = RenderConfig.worldSpace;
        this.currentLine.isPickable = false;
    }

    /**
     * Completes the current measurement with the given end point.
     * @param endPoint - The ending point of the measurement.
     */
    public CompleteMeasurement(endPoint: Vector3): void 
    {
        const distance = Vector3.Distance(this.startPoint, endPoint);

        // The ID we send dosen't matter because the server assigns the measurement ID
        const measurementId = -1;
        const sendData = 
        {
            measurement_instance_id: measurementId,
            startPoint: this.startPoint,
            endPoint: endPoint,
            distanceMeasured: distance
        };

        // Send the measurement data to the server
        this.SendCreateNewMeasurementRequestToServer(sendData);
        this.selectedMeasurementId = measurementId;

        //dispose tool line UI
        if (this.currentLine) 
        {
            this.currentLine.dispose();
        }

        // Dispose of the dynamic text
        if (this.dynamicTextMesh) 
        {
            this.dynamicTextMesh.dispose();
            this.dynamicTextMesh = null;
        }

        // Reset for the next measurement
        this.startPoint = null;
        this.currentLine = null;
    }

    /**
     * Updates the measurement display while dragging.
     * @param pickedPoint - The current endpoint based on pointer position.
     */
    public UpdateMeasuringDisplay(pickedPoint: Vector3): void 
    {
        if (!this.startPoint) return;
        
        // Update the line to show the current measurement
        this.currentLine = MeshBuilder.CreateLines("measureLine", 
        {
            points: [this.startPoint, pickedPoint],
            instance: this.currentLine
        });

        const distance = Vector3.Distance(this.startPoint, pickedPoint);
        const midPoint = this.startPoint.add(pickedPoint).scale(0.5);

        // Clean up previous text mesh if it exists
        if (this.dynamicTextMesh) 
        {
            this.dynamicTextMesh.dispose();
        }
        
        this.dynamicTextMesh = this.CreateMeasurementText(`${distance.toFixed(2)}m`, midPoint);
    }

    /**
     * Creates a 3D text mesh at the specified position with a dark outline for better visibility.
     * @param text - The text to display.
     * @param position - The position of the text in 3D space.
     * @returns A mesh representing the 3D text.
     */
    public CreateMeasurementText(text: string, position: Vector3): Mesh 
    {
        // Create a temporary plate object just for text rendering
        const tempPlateObject = new MeasurementPlateObject(
            -1,
            Vector3.Zero(),
            Vector3.Zero(),
            0,
            this.scene
        );
        return tempPlateObject.Create3DText(text, position);
    }

    /**
     * Disables the measuring functionality, stopping any active measurements.
     * Cleans up event listeners and resets the current measurement state.
     */
    private DisableMeasuring(): void {
        if (!this.scene) return;

        if (this.pointerObserver) 
            {
            this.scene.onPointerObservable.remove(this.pointerObserver);
            this.pointerObserver = null;
        }
        
        if (this.beforeRenderObserver) 
            {
            this.scene.onBeforeRenderObservable.remove(this.beforeRenderObserver);
            this.beforeRenderObserver = null;
        }
        
        if (this.currentActionState !== ActionStates.None) 
        {
            this.SetActionState(ActionStates.None);
        }
        
        // Clear state
        this.startPoint = null;
        this.isDraggingMeasurement = false;
        
        // Dispose of resources
        if (this.currentLine) 
            {
            this.currentLine.dispose();
            this.currentLine = null;
        }
        
        if (this.dynamicTextMesh) 
            {
            this.dynamicTextMesh.dispose();
            this.dynamicTextMesh = null;
        }
    }

    /**
     * Attempts to add a measurement entry and create its respective UI objects.
     * @param jsonData The data used to create the measurement entry.
     */
    public TryAddMeasurementObject(jsonData: 
        {
        measurement_instance_id: number,
        startPoint: Vector3,
        endPoint: Vector3,
        distanceMeasured: number
    }): void 
    {
        if (!MeasureMenuController.instance) 
            {
            console.error("MeasureMenuController instance not initialized");
            return;
        }
        
        if (this.measurementsList.has(jsonData.measurement_instance_id)) 
            {
            console.log(`Measurement ID ${jsonData.measurement_instance_id} already exists.`);
            return;
        }

        try 
        {
            let startPoint: Vector3;
            let endPoint: Vector3;
            
            if (jsonData.startPoint instanceof Vector3) 
                {
                startPoint = jsonData.startPoint;
            } else 
                {
                // Handle different JSON formats for Vector3
                const sp = jsonData.startPoint as any;
                startPoint = new Vector3(
                    sp._x !== undefined ? sp._x : (sp.x !== undefined ? sp.x : 0),
                    sp._y !== undefined ? sp._y : (sp.y !== undefined ? sp.y : 0),
                    sp._z !== undefined ? sp._z : (sp.z !== undefined ? sp.z : 0)
                );
            }
            
            if (jsonData.endPoint instanceof Vector3) 
                {
                endPoint = jsonData.endPoint;
            } else
                 {
                // Handle different JSON formats for Vector3
                const ep = jsonData.endPoint as any;
                endPoint = new Vector3(
                    ep._x !== undefined ? ep._x : (ep.x !== undefined ? ep.x : 0),
                    ep._y !== undefined ? ep._y : (ep.y !== undefined ? ep.y : 0),
                    ep._z !== undefined ? ep._z : (ep.z !== undefined ? ep.z : 0)
                );
            }
                
            const distance = jsonData.distanceMeasured;

            // ============= Create UI and store them =============
            const newMeasurementPlate = new MeasurementPlateObject(
                jsonData.measurement_instance_id,
                startPoint,
                endPoint,
                distance,
                this.scene
            );
            newMeasurementPlate.InitPlate();

            // Store the measurement in both maps
            this.measurementsList.set(jsonData.measurement_instance_id, newMeasurementPlate);
            this.plateObjects.set(jsonData.measurement_instance_id, newMeasurementPlate);
        } catch (error) 
        {
            console.error("Error adding measurement object:", error);
        }
    }

    // ================= Networking /websocket functions =================
    // Use these for sending measured data to the server, 
    // which the server will then broadcast to all other clients.

    /**
     * Called when user creates a new measurement.
     * Will send a request to the server to broadcast the new measurement to all
     * users in the room.
     * @param sendData - The data to send to the server.
     */
    private SendCreateNewMeasurementRequestToServer(sendData: {
        measurement_instance_id: number,
        startPoint: Vector3,
        endPoint: Vector3,
        distanceMeasured: number
    }): void 
    {
        try 
        {
            // This function is what sends data from the client to the server.
            // first para "SocketHandler.CodeToServer.EditServer_ClientRequest_CreateMeasurementObject,"
            // is a number code that tells the server how they should process the `sendData`, and what to do with it.
            // 2nd para "sendData", is the above json data const previously created that will be sent to the server.
            // Send data from the client to the server
            SocketHandler.SendData(
                SocketHandler.CodeToServer.EditServer_ClientRequest_CreateMeasurementObject,
                sendData
            );

            console.log("New measurement request sent to server:", sendData.measurement_instance_id);
        } catch (error) {
            console.error("Error sending measurement to server:", error);
        }
    }

    /**
     * This function is called in the `HandleRoomUpdate` func of `Sessionmanager.ts`.
     * It processes data sent from the server to create the measurement data, UI, etc.
     * @param measureDataArray An array of measurementData in json format.
     */
    public ReceiveCreateNewMeasurementRequestFromServer(measureDataArray: any[]): void {
        if (!Array.isArray(measureDataArray)) {
            console.error("Received invalid measurement data format");
            return;
        }

        console.log(`Received ${measureDataArray.length} measurements from server`);

        // Process each measurement object in measureDataArray
        measureDataArray.forEach((dataEntry: 
            {
            measurement_instance_id: number,
            startPoint: Vector3,
            endPoint: Vector3,
            distanceMeasured: number
        }) => {
            if (dataEntry && dataEntry.measurement_instance_id) 
                {
                this.TryAddMeasurementObject(dataEntry);
            } else {
                console.warn("Received invalid measurement data entry:", dataEntry);
            }
        });
    }

    /**
     * Clears all measurement data from the list.
     */
    public ClearMeasurementData(): void 
    {
        this.measurementsList.clear();
    }

    /**
     * Clears all GUI objects associated with measurements.
     */
    public ClearGUIObjects(): void 
    {
        for (const measurementPlate of this.plateObjects.values()) 
            {
            if (measurementPlate) 
                {
                measurementPlate.ClearGUI();
            }
        }
        
        this.plateObjects.clear();
    }
    
    /**
     * Updates an existing measurement with new points
     * @param measurementId - The ID of the measurement to update
     * @param newStartPoint - The new start point
     * @param newEndPoint - The new end point
     */
    public UpdateExistingMeasurement(measurementId: number, newStartPoint: Vector3, newEndPoint: Vector3): void {

        const plateObject = this.plateObjects.get(measurementId);
        const measurementData = this.measurementsList.get(measurementId);
        
        if (!plateObject || !measurementData) 
            {
            console.error(`Measurement ${measurementId} not found`);
            return;
        }

        const distance = Vector3.Distance(newStartPoint, newEndPoint);

        // Update the measurement data
        measurementData.startPoint = newStartPoint;
        measurementData.endPoint = newEndPoint;
        measurementData.distanceMeasured = distance;

        plateObject.UpdateMeasurement(newStartPoint, newEndPoint);

        if (plateObject.startPointCollider) 
            {
            plateObject.startPointCollider.metadata.measurementId = measurementId;
        }
        if (plateObject.endPointCollider) 
            {
            plateObject.endPointCollider.metadata.measurementId = measurementId;
        }

        // Send update to server
        this.SendUpdateMeasurementRequestToServer(
            {
            measurement_instance_id: measurementId,
            startPoint: newStartPoint,
            endPoint: newEndPoint,
            distanceMeasured: distance
        });
    }

    /**
     * Sends measurement update to server
     */
    private SendUpdateMeasurementRequestToServer(sendData: {
        measurement_instance_id: number,
        startPoint: Vector3,
        endPoint: Vector3,
        distanceMeasured: number
    }): void 
    {
        try {
            
            SocketHandler.SendData(
                SocketHandler.CodeToServer.EditServer_ClientRequest_UpdateMeasurementObject, 
                sendData
            );

            console.log("Measurement update sent to server:", sendData.measurement_instance_id);
        } catch (error) 
        {
            console.error("Error sending measurement update to server:", error);
        }
    }

    /**
     * Handles receiving measurement updates from server
     */
    public ReceiveUpdateMeasurementRequestFromServer(updateData: 
        {
        measurement_instance_id: number,
        startPoint: Vector3,
        endPoint: Vector3,
        distanceMeasured: number
    }): void 
    {
        const plateObject = this.plateObjects.get(updateData.measurement_instance_id);
        const measurementData = this.measurementsList.get(updateData.measurement_instance_id);
        
        if (!plateObject || !measurementData) 
            {
            console.warn(`Received update for unknown measurement ${updateData.measurement_instance_id}`);
            return;
        }

        let startPoint: Vector3;
        let endPoint: Vector3;
        
        if (updateData.startPoint instanceof Vector3) 
            {
            startPoint = updateData.startPoint;
        } else // Wesley: We know it's in JSON format
            {
            const sp = updateData.startPoint as any;
            startPoint = new Vector3(
                sp._x !== undefined ? sp._x : (sp.x !== undefined ? sp.x : 0),
                sp._y !== undefined ? sp._y : (sp.y !== undefined ? sp.y : 0),
                sp._z !== undefined ? sp._z : (sp.z !== undefined ? sp.z : 0)
            );
        }
        
        if (updateData.endPoint instanceof Vector3) {
            endPoint = updateData.endPoint;
        } else {
            const ep = updateData.endPoint as any;
            endPoint = new Vector3(
                ep._x !== undefined ? ep._x : (ep.x !== undefined ? ep.x : 0),
                ep._y !== undefined ? ep._y : (ep.y !== undefined ? ep.y : 0),
                ep._z !== undefined ? ep._z : (ep.z !== undefined ? ep.z : 0)
            );
        }

        // Update the measurement data
        measurementData.startPoint = startPoint;
        measurementData.endPoint = endPoint;
        measurementData.distanceMeasured = updateData.distanceMeasured;

        // Update the plate object with new data
        plateObject.UpdateMeasurement(startPoint, endPoint);

        if (plateObject.startPointCollider) {
            plateObject.startPointCollider.metadata.measurementId = updateData.measurement_instance_id;
        }
        if (plateObject.endPointCollider) {
            plateObject.endPointCollider.metadata.measurementId = updateData.measurement_instance_id;
        }

        console.log(`Updated measurement ${updateData.measurement_instance_id} from server`);
    }

}
