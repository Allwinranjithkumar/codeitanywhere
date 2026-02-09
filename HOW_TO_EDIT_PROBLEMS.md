# How to Customize Problems

All the coding problems are stored in a single file: `problems/problems.json`.
To change the questions or reduce the number of problems, you just need to edit this file.

## File Location
`problems/problems.json`

## How to Edit
1.  Open the file in any text editor (Notepad, VS Code).
2.  It contains a list (array) of problem objects.
3.  Each problem looks like this:

```json
{
    "id": 0,
    "title": "Problem Title",
    "description": "Description of the task...",
    "difficulty": "Easy",
    "points": 100,
    "testCases": [ ... ],
    "starterCode": { ... },
    "functionName": "solve"
}
```

### To Remove Problems
Simply **delete** the blocks you don't want.
*   **Important**: Make sure the remaining list is still valid JSON (comma between items, no comma after the last item).
*   **IDs**: You can renumber the `"id"` fields to `0, 1` if you only have 2 problems, but it's not strictly necessary (the app handles gaps).

### To Add/Edit Problems
1.  **Title/Description**: Change the text.
2.  **Test Cases**: This is the most important part.
    *   `input`: The arguments passed to the function.
    *   `output`: The expected return value.
3.  **Starter Code**: Update the C++, Python, and Java templates to match the new function signature.
4.  **Function Name**: Ensure this matches what you use in your starter code/test cases.

### Example: "Two Sum" Problem
If you want to add "Two Sum", your `testCases` would look like:
```json
"testCases": [
    { "input": [[2,7,11,15], 9], "output": [0,1] }
]
```
And your C++ starter code function signature should accept a vector and an int.

## Accessing the File
*   **Locally**: It's in your project folder.
*   **On GitHub**: Go to your repo -> `problems` folder -> `problems.json` -> Click the Pencil icon to edit -> Commit changes.
*   **On Render**: Render will automatically pull the changes from GitHub and restart.
