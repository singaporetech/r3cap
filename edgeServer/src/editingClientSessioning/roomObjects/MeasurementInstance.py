"""
@file MeasurementInstance.py
@description Represents a measurement object on the server side.
Stores measurement data (startPoint, endPoint, distance) and manages
serialization/deserialization for client communication and persistence.
Tracks state changes with is_dirty and mark_delete flags for synchronization.

@author nirmalsnair, leonfoo, wesleyqua
@date 09/12/2024
"""

INVALID_ID_NUM = -1

# Represents a measure object IN THE SERVER.
class MeasurementInstance:

    def __init__(self,                
        measurement_instance_id,
        startPoint,
        endPoint,        
        distanceMeasured
                ):
        
        self.global_instance_id = INVALID_ID_NUM        
        self.measurement_instance_id = measurement_instance_id      

        self.startPoint = startPoint
        self.endPoint = endPoint

        self.distanceMeasured = distanceMeasured

        self.is_dirty = False
        self.mark_delete = False

    def to_dict(self):
        dict_ = {
            "measurement_instance_id": self.measurement_instance_id,
            "startPoint": self.startPoint,
            "endPoint": self.endPoint,
            "distanceMeasured": self.distanceMeasured,
        }
        return dict_

    def to_client_update_dict(self):
        dict_ = {
            "measurement_instance_id": self.measurement_instance_id,
            "startPoint": self.startPoint,
            "endPoint": self.endPoint,
            "distanceMeasured": self.distanceMeasured,
            "mark_delete": self.mark_delete,
        }
        return dict_
    
    # Deserialization from json file.
    @classmethod
    def from_dict(cls, dict_):
        return cls(
            dict_["measurement_instance_id"],
            dict_["startPoint"],
            dict_["endPoint"],
            dict_["distanceMeasured"],
        )
    
    @classmethod
    def create_new_instance_from_dict(cls, dict_):
        return cls(
            dict_["measurement_instance_id"],
            dict_["startPoint"],
            dict_["endPoint"],
            dict_["distanceMeasured"],
        )

    def update_from_json(self, jsonData: dict[str, any]):
        self.measurement_instance_id = jsonData["measurement_instance_id"]
        self.startPoint = jsonData["startPoint"]
        self.endPoint = jsonData["endPoint"]
        self.distanceMeasured = jsonData["distanceMeasured"]
        # mark_delete does not need to be serialized
