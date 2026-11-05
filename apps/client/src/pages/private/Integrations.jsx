import { useCallback, useEffect, useState } from "react";

import { Empty } from "antd";
import { MapPin } from "lucide-react";

import Badge from "../../components/ui/Badge";
import PageHeader from "../../components/ui/PageHeader";
import CustomButton from "../../components/ui/CustomButton";

import useApi from "../../hooks/useApi";

import { integrationsEndpoints } from "../../services/integrations.service";

import { useNotify } from "../../context/notification/useNotify";

const Integrations = () => {
  const { notify } = useNotify();
  const { loading, callApi } = useApi({ connectionsLoading: true });

  const [connections, setConnections] = useState([]);

  const fetchConnections = useCallback(() => {
    callApi("connectionsLoading", integrationsEndpoints.getConnections, {
      loading: false,
      onSuccess: ({ data }) => {
        console.log("Connections: ", data);
        setConnections(data?.connections || []);
      },
      onError: () => {},
    });
  }, [callApi]);

  const reconcileLocations = () => {
    callApi("reconciling", integrationsEndpoints.reconcileLocations, {
      onSuccess: () => {
        notify.msgSuccess("Locations reconciled!");
      },
      onError: () => {
        notify.msgError("Locations reconcilation failed!");
      },
    });
  };

  const activateConnection = (connectionId) => {
    callApi(
      "activating",
      () => integrationsEndpoints.activateConnection(connectionId),
      {
        onSuccess: () => {
          fetchConnections();
          notify.msgSuccess("Organization activated!");
        },
        onError: () => {
          notify.msgError("Failed to activate organization!");
        },
      },
    );
  };

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        heading="Integrations"
        subHeading="Connect and manage your data sources"
      />

      <div className="p-6 border border-gray-300 rounded-xl">
        <div className="flex flex-col gap-4">
          <p>Connected Google Accounts</p>

          {loading.connectionsLoading ? (
            <div>Loading...</div>
          ) : connections?.length > 0 ? (
            <div className="flex flex-col gap-2">
              {connections?.map((connection) => {
                const { id, is_active, email } = connection || {};

                return (
                  <div
                    key={id}
                    className="p-3 flex items-center justify-between gap-3 text-sm border border-gray-300 rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      {email}{" "}
                      {is_active && <Badge variant="green" text="Active" />}
                    </div>

                    {is_active ? (
                      <CustomButton
                        icon={MapPin}
                        name="Reconcile"
                        onClick={reconcileLocations}
                      />
                    ) : (
                      <CustomButton
                        name="Activate"
                        onClick={() => activateConnection(id)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty />
          )}
        </div>
      </div>
    </div>
  );
};

export default Integrations;
