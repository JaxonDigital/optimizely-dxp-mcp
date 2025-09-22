#!/usr/bin/env python3
"""
Jira Helper Script - Working solution for Jira API v3
Use this instead of the broken jira CLI tool
"""

import urllib.request
import base64
import json
import sys

class JiraHelper:
    def __init__(self):
        self.url = "https://jaxondigital.atlassian.net"
        self.email = "bgerby@jaxondigital.com"

        # Read token
        with open("/Users/bgerby/.jira.d/.pass", "r") as f:
            self.token = f.read().strip()

        # Setup auth
        auth_string = f"{self.email}:{self.token}"
        auth_bytes = auth_string.encode('ascii')
        self.auth_b64 = base64.b64encode(auth_bytes).decode('ascii')

    def list_tickets(self, project="DXP", max_results=30):
        """List tickets in a project"""
        # Direct ticket enumeration since search/jql returns 0 results
        tickets_found = {}

        for ticket_id in range(max_results, 0, -1):
            ticket_key = f"{project}-{ticket_id}"
            try:
                req = urllib.request.Request(f"{self.url}/rest/api/3/issue/{ticket_key}")
                req.add_header('Authorization', f'Basic {self.auth_b64}')
                req.add_header('Accept', 'application/json')

                response = urllib.request.urlopen(req)
                data = json.loads(response.read())

                fields = data.get('fields', {})
                summary = fields.get('summary', 'No summary')
                status = fields.get('status', {}).get('name', 'Unknown')
                assignee = fields.get('assignee', {})
                assignee_name = assignee.get('displayName', 'Unassigned') if assignee else 'Unassigned'

                if status not in tickets_found:
                    tickets_found[status] = []

                tickets_found[status].append({
                    'key': ticket_key,
                    'summary': summary[:60] + ('...' if len(summary) > 60 else ''),
                    'assignee': assignee_name
                })
            except:
                pass  # Ticket doesn't exist

        # Display by status
        status_order = ['Gathering Requirements', 'Ready for Dev', 'In Progress', 'Ready for QA', 'Client QA', 'Ready for Deploy', 'Done']

        print(f"\n{project} Tickets:")
        print("=" * 80)

        for status in status_order:
            if status in tickets_found:
                if status in ['Done', 'Ready for Deploy']:
                    continue  # Skip completed tickets
                print(f"\n[{status}] ({len(tickets_found[status])} tickets)")
                print("-" * 70)
                for ticket in sorted(tickets_found[status], key=lambda x: int(x['key'].split('-')[1]), reverse=True):
                    print(f"  {ticket['key']}: {ticket['summary']}")
                    if ticket['assignee'] != 'Unassigned':
                        print(f"    → Assignee: {ticket['assignee']}")

    def update_status(self, ticket_key, new_status):
        """Update ticket status"""
        # Get available transitions
        transitions_url = f"{self.url}/rest/api/3/issue/{ticket_key}/transitions"
        req = urllib.request.Request(transitions_url)
        req.add_header('Authorization', f'Basic {self.auth_b64}')
        req.add_header('Accept', 'application/json')

        try:
            response = urllib.request.urlopen(req)
            data = json.loads(response.read())

            # Find the transition ID
            transition_id = None
            for transition in data.get('transitions', []):
                if transition['name'].lower() == new_status.lower():
                    transition_id = transition['id']
                    break

            if not transition_id:
                print(f"Status '{new_status}' not available")
                return False

            # Perform the transition
            transition_data = {"transition": {"id": transition_id}}
            req = urllib.request.Request(transitions_url,
                                        data=json.dumps(transition_data).encode('utf-8'),
                                        method='POST')
            req.add_header('Authorization', f'Basic {self.auth_b64}')
            req.add_header('Content-Type', 'application/json')
            req.add_header('Accept', 'application/json')

            response = urllib.request.urlopen(req)
            print(f"✅ Updated {ticket_key} to {new_status}")
            return True

        except Exception as e:
            print(f"❌ Failed: {e}")
            return False

    def get_ticket(self, ticket_key):
        """Get ticket details"""
        req = urllib.request.Request(f"{self.url}/rest/api/3/issue/{ticket_key}")
        req.add_header('Authorization', f'Basic {self.auth_b64}')
        req.add_header('Accept', 'application/json')

        try:
            response = urllib.request.urlopen(req)
            data = json.loads(response.read())
            fields = data.get('fields', {})

            print(f"\n{ticket_key}: {fields.get('summary', 'No summary')}")
            print(f"Status: {fields.get('status', {}).get('name', 'Unknown')}")

            assignee = fields.get('assignee', {})
            assignee_name = assignee.get('displayName', 'Unassigned') if assignee else 'Unassigned'
            print(f"Assignee: {assignee_name}")

            # Parse description
            description = fields.get('description')
            if description and isinstance(description, dict):
                print("\nDescription:")
                for block in description.get('content', []):
                    if block.get('type') == 'paragraph':
                        for item in block.get('content', []):
                            if item.get('type') == 'text':
                                print(item.get('text', ''))

            return data

        except Exception as e:
            print(f"Error: {e}")
            return None

# Main CLI interface
if __name__ == "__main__":
    helper = JiraHelper()

    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 jira_helper.py list [PROJECT]")
        print("  python3 jira_helper.py get TICKET-KEY")
        print("  python3 jira_helper.py status TICKET-KEY NEW-STATUS")
        sys.exit(1)

    command = sys.argv[1]

    if command == "list":
        project = sys.argv[2] if len(sys.argv) > 2 else "DXP"
        helper.list_tickets(project)
    elif command == "get":
        if len(sys.argv) < 3:
            print("Please specify ticket key (e.g., DXP-28)")
            sys.exit(1)
        helper.get_ticket(sys.argv[2])
    elif command == "status":
        if len(sys.argv) < 4:
            print("Usage: python3 jira_helper.py status TICKET-KEY NEW-STATUS")
            sys.exit(1)
        helper.update_status(sys.argv[2], sys.argv[3])