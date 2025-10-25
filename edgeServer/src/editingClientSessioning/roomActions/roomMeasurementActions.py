"""
@file roomMeasurementActions.py
@description Defines action classes for managing measurement lifecycle on the server.
Handles creation, updating, and deletion of measurements within a room instance.
Each action class encapsulates the logic for a specific measurement operation and
maintains consistency with the room's measurement state.

@author nirmalsnair, leonfoo, wesleyqua
@date 09/12/2024
"""

# from roomObjects.markerInstance import MarkerInstance
# from roomObjects.meshInstance import MeshInstance
from editingClientSessioning.roomObjects.MeasurementInstance import MeasurementInstance
from editingClientSessioning.roomObjects.annotationInstance import AnnotationInstance
from editingClientSessioning.roomManagement.roomInstance import RoomInstance

# A sort of 'helper' class that will create measurement objects IN THE SERVER only.
class CreateMeasurementInstance:
    '''
    Creates measurement object and adds it to a `RoomInstance` object
    '''
    def __init__(self, dict_):
        self.measurement_instance = MeasurementInstance.create_new_instance_from_dict(dict_)

    # Just used to call '_add_measurement_instance_to_room' func
    def invoke(self, room_instance: RoomInstance):
        self._add_measurement_instance_to_room(room_instance)
        pass

    def _add_measurement_instance_to_room(self, room_instance: RoomInstance):
        # Update related variables
        room_instance.measurement_instance_count += 1
        room_instance.global_instance_count += 1

        self.measurement_instance.is_dirty = True
        self.measurement_instance.measurement_instance_id = room_instance.measurement_instance_count

        # Add measurement to room
        room_instance.measurement_instance_dict[self.measurement_instance.measurement_instance_id] = self.measurement_instance

class UpdateMeasurementInstance:
    def __init__(self, measurement_data: dict[str, any]):
        self.measurement_data = measurement_data

    def invoke(self, room_instance: RoomInstance):
        ref_measurements: MeasurementInstance | None

        if self.measurement_data["measurement_instance_id"] not in room_instance.measurement_instance_dict:
            return
        ref_measurements = room_instance.measurement_instance_dict[self.measurement_data["measurement_instance_id"]]
        ref_measurements.update_from_json(self.measurement_data)
        # set diry, marking for updates
        ref_measurements.is_dirty = True

        room_instance.measurement_instance_dict[ref_measurements.measurement_instance_id] = ref_measurements

class DeleteMeasurementInstance:
    def __init__(self, measurement_data: dict[str, any]):
        self.measurement_data = measurement_data

    def invoke(self, room_instance: RoomInstance):
        ref_measure: MeasurementInstance | None

        if self.measurement_data["measurement_instance_id"] not in room_instance.measurement_instance_dict:
            return
        
        ref_measure = room_instance.measurement_instance_dict[self.measurement_data["measurement_instance_id"]]
        # set mark for deletion
        ref_measure.is_dirty = True
        ref_measure.mark_delete = True        
        room_instance.deleted_measurements.append(ref_measure.measurement_instance_id)

        # force update measurement
        room_instance.measurement_instance_dict[ref_measure.measurement_instance_id] = ref_measure
